#!/usr/bin/env python3
import json, subprocess, sys
from pathlib import Path

SCRIPT = Path(__file__).parent.parent / 'django_models.py'

def run(args, stdin=None):
    return subprocess.run(
        [sys.executable, str(SCRIPT)] + args,
        capture_output=True, text=True, input=stdin
    )

def test_simple_model():
    py = """
from django.db import models

class User(models.Model):
    email = models.CharField(max_length=255, unique=True)
    name = models.CharField(max_length=100, null=True)
"""
    r = run(['-'], stdin=py)
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout)
    t = out['tables'][0]
    assert t['id'] == 'user'
    assert t['type'] == 'entity'
    cols = {c['name']: c for c in t['columns']}
    assert cols['id']['pk'] is True   # auto pk
    assert cols['email']['unique'] is True
    assert cols['email']['type'] == 'string(255)'
    assert cols['name']['nullable'] is True

def test_foreign_key():
    py = """
from django.db import models

class Order(models.Model):
    customer = models.ForeignKey('Customer', on_delete=models.CASCADE)
"""
    r = run(['-'], stdin=py)
    out = json.loads(r.stdout)
    cols = {c['name']: c for c in out['tables'][0]['columns']}
    assert 'customer_id' in cols
    assert cols['customer_id']['fk'] == {'table': 'customer', 'on_delete': 'cascade'}

def test_one_to_one_extension():
    py = """
from django.db import models

class EBook(models.Model):
    book = models.OneToOneField('Book', on_delete=models.CASCADE, primary_key=True)
    format = models.CharField(max_length=10)
"""
    r = run(['-'], stdin=py)
    out = json.loads(r.stdout)
    assert out['tables'][0]['type'] == 'extension'

def test_no_models_model_warning():
    py = "def hello(): pass"
    r = run(['-'], stdin=py)
    assert r.returncode == 0
    assert 'warning' in r.stderr.lower()

def test_wrong_extension():
    r = run(['schema.sql'])
    assert r.returncode == 1

if __name__ == '__main__':
    tests = [v for k,v in sorted(globals().items()) if k.startswith('test_')]
    failed = 0
    for t in tests:
        try:
            t(); print(f'  PASS  {t.__name__}')
        except Exception as e:
            print(f'  FAIL  {t.__name__}: {e}'); failed += 1
    print(f'\n{len(tests)-failed}/{len(tests)} passed')
    sys.exit(failed)
