#!/usr/bin/env python3
import json, subprocess, sys, tempfile
from pathlib import Path

SCRIPT = Path(__file__).parent.parent / 'sql_ddl.py'

def run(args, stdin=None):
    return subprocess.run(
        [sys.executable, str(SCRIPT)] + args,
        capture_output=True, text=True, input=stdin
    )

def test_simple_table():
    sql = """
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(100)
);
"""
    r = run(['-'], stdin=sql)
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout)
    assert len(out['tables']) == 1
    t = out['tables'][0]
    assert t['id'] == 'users'
    assert t['name'] == 'Users'
    assert t['type'] == 'entity'
    assert t['domain'] == 'main'
    cols = {c['name']: c for c in t['columns']}
    assert cols['id']['pk'] is True
    assert cols['email']['nullable'] is False
    assert cols['email']['unique'] is True

def test_inline_fk():
    sql = """
CREATE TABLE orders (
    id UUID PRIMARY KEY,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE
);
"""
    r = run(['-'], stdin=sql)
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout)
    cols = {c['name']: c for c in out['tables'][0]['columns']}
    assert cols['customer_id']['fk'] == {'table': 'customers', 'on_delete': 'cascade'}

def test_table_level_fk():
    sql = """
CREATE TABLE order_lines (
    id UUID,
    order_id UUID NOT NULL,
    book_id UUID NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (book_id) REFERENCES books(id)
);
"""
    r = run(['-'], stdin=sql)
    out = json.loads(r.stdout)
    cols = {c['name']: c for c in out['tables'][0]['columns']}
    assert cols['order_id']['fk'] == {'table': 'orders', 'on_delete': 'cascade'}
    assert cols['book_id']['fk'] == 'books'

def test_pivot_type():
    sql = """
CREATE TABLE book_genres (
    book_id UUID NOT NULL REFERENCES books(id),
    genre_id UUID NOT NULL REFERENCES genres(id),
    PRIMARY KEY (book_id, genre_id)
);
"""
    r = run(['-'], stdin=sql)
    out = json.loads(r.stdout)
    assert out['tables'][0]['type'] == 'pivot'

def test_extension_type():
    sql = """
CREATE TABLE ebooks (
    book_id UUID PRIMARY KEY REFERENCES books(id),
    format VARCHAR(10) NOT NULL
);
"""
    r = run(['-'], stdin=sql)
    out = json.loads(r.stdout)
    assert out['tables'][0]['type'] == 'extension'

def test_enum():
    sql = """
CREATE TYPE order_status AS ENUM ('pending', 'paid', 'shipped');
CREATE TABLE orders (id UUID PRIMARY KEY);
"""
    r = run(['-'], stdin=sql)
    out = json.loads(r.stdout)
    assert out['enums'][0]['id'] == 'order_status'
    assert out['enums'][0]['values'][0]['code'] == 'pending'

def test_multi_file_domains():
    with tempfile.TemporaryDirectory() as d:
        Path(d, 'commercial.sql').write_text(
            'CREATE TABLE publishers (id UUID PRIMARY KEY);')
        Path(d, 'sales.sql').write_text(
            'CREATE TABLE orders (id UUID PRIMARY KEY);')
        r = run([str(Path(d,'commercial.sql')), str(Path(d,'sales.sql'))])
        out = json.loads(r.stdout)
        domains = {t['id']: t['domain'] for t in out['tables']}
        assert domains['publishers'] == 'commercial'
        assert domains['orders'] == 'sales'

def test_wrong_extension():
    r = run(['schema.rb'])
    assert r.returncode == 1
    assert 'error' in r.stderr.lower()

def test_meta_fields():
    r = run(['-'], stdin='CREATE TABLE x (id INT PRIMARY KEY);')
    out = json.loads(r.stdout)
    assert out['meta']['source'] == 'sql_ddl'
    assert 'converted_at' in out['meta']

if __name__ == '__main__':
    tests = [v for k,v in sorted(globals().items()) if k.startswith('test_')]
    failed = 0
    for t in tests:
        try:
            t()
            print(f'  PASS  {t.__name__}')
        except Exception as e:
            print(f'  FAIL  {t.__name__}: {e}')
            failed += 1
    print(f'\n{len(tests)-failed}/{len(tests)} passed')
    sys.exit(failed)
