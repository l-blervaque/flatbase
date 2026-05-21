#!/usr/bin/env python3
import json, subprocess, sys
from pathlib import Path

SCRIPT = Path(__file__).parent.parent / 'dbml.py'

def run(args, stdin=None):
    return subprocess.run(
        [sys.executable, str(SCRIPT)] + args,
        capture_output=True, text=True, input=stdin
    )

def test_simple_table():
    dbml = """
Table users {
  id uuid [pk]
  email varchar [not null, unique]
  name varchar
}
"""
    r = run(['-'], stdin=dbml)
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout)
    t = out['tables'][0]
    assert t['id'] == 'users'
    assert t['type'] == 'entity'
    cols = {c['name']: c for c in t['columns']}
    assert cols['id']['pk'] is True
    assert cols['email']['unique'] is True
    assert cols['email']['nullable'] is False

def test_inline_ref():
    dbml = """
Table orders {
  id uuid [pk]
  customer_id uuid [ref: > customers.id]
}
"""
    r = run(['-'], stdin=dbml)
    out = json.loads(r.stdout)
    cols = {c['name']: c for c in out['tables'][0]['columns']}
    assert cols['customer_id']['fk'] == 'customers'

def test_external_ref():
    dbml = """
Table orders {
  id uuid [pk]
  customer_id uuid
}
Ref: orders.customer_id > customers.id
"""
    r = run(['-'], stdin=dbml)
    out = json.loads(r.stdout)
    cols = {c['name']: c for c in out['tables'][0]['columns']}
    assert cols['customer_id']['fk'] == 'customers'

def test_table_group_as_domain():
    dbml = """
Table publishers { id uuid [pk] }
Table books { id uuid [pk] }
Table orders { id uuid [pk] }
TableGroup commercial { publishers books }
TableGroup sales { orders }
"""
    r = run(['-'], stdin=dbml)
    out = json.loads(r.stdout)
    domains = {t['id']: t['domain'] for t in out['tables']}
    assert domains['publishers'] == 'commercial'
    assert domains['books'] == 'commercial'
    assert domains['orders'] == 'sales'

def test_enum():
    dbml = """
Enum order_status { pending paid shipped }
Table orders { id uuid [pk] }
"""
    r = run(['-'], stdin=dbml)
    out = json.loads(r.stdout)
    assert out['enums'][0]['id'] == 'order_status'

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
