#!/usr/bin/env python3
import json, subprocess, sys
from pathlib import Path

SCRIPT = Path(__file__).parent.parent / 'rails_schema.py'

def run(args, stdin=None):
    return subprocess.run(
        [sys.executable, str(SCRIPT)] + args,
        capture_output=True, text=True, input=stdin
    )

def test_simple_table():
    rb = """
ActiveRecord::Schema[7.0].define do
  create_table "users", force: :cascade do |t|
    t.string "email", null: false, limit: 255
    t.string "name"
    t.datetime "created_at", null: false
  end
end
"""
    r = run(['-'], stdin=rb)
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout)
    t = out['tables'][0]
    assert t['id'] == 'users'
    assert t['type'] == 'entity'
    cols = {c['name']: c for c in t['columns']}
    assert cols['id']['pk'] is True
    assert cols['email']['nullable'] is False
    assert cols['email']['type'] == 'string(255)'

def test_references():
    rb = """
create_table "orders" do |t|
  t.references "customer", null: false, foreign_key: true
end
"""
    r = run(['-'], stdin=rb)
    out = json.loads(r.stdout)
    cols = {c['name']: c for c in out['tables'][0]['columns']}
    assert 'customer_id' in cols
    assert cols['customer_id']['fk'] == 'customer'

def test_add_foreign_key():
    rb = """
create_table "order_lines" do |t|
  t.bigint "order_id", null: false
  t.bigint "book_id", null: false
end
add_foreign_key "order_lines", "orders"
add_foreign_key "order_lines", "books"
"""
    r = run(['-'], stdin=rb)
    out = json.loads(r.stdout)
    cols = {c['name']: c for c in out['tables'][0]['columns']}
    assert cols['order_id']['fk'] == 'orders'
    assert cols['book_id']['fk'] == 'books'

def test_no_id_table():
    rb = """
create_table "book_genres", id: false do |t|
  t.bigint "book_id", null: false
  t.bigint "genre_id", null: false
end
"""
    r = run(['-'], stdin=rb)
    out = json.loads(r.stdout)
    col_names = [c['name'] for c in out['tables'][0]['columns']]
    assert 'id' not in col_names

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
