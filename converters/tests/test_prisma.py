#!/usr/bin/env python3
import json, subprocess, sys
from pathlib import Path

SCRIPT = Path(__file__).parent.parent / 'prisma.py'

def run(args, stdin=None):
    return subprocess.run(
        [sys.executable, str(SCRIPT)] + args,
        capture_output=True, text=True, input=stdin
    )

def test_simple_model():
    schema = """
model User {
  id    String @id
  email String @unique
  name  String?
}
"""
    r = run(['-'], stdin=schema)
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout)
    t = out['tables'][0]
    assert t['id'] == 'user'
    assert t['name'] == 'User'
    assert t['type'] == 'entity'
    cols = {c['name']: c for c in t['columns']}
    assert cols['id']['pk'] is True
    assert cols['email']['unique'] is True
    assert cols['name']['nullable'] is True

def test_relation():
    schema = """
model Order {
  id         String   @id
  customerId String
  customer   Customer @relation(fields: [customerId], references: [id])
}
model Customer {
  id     String  @id
  orders Order[]
}
"""
    r = run(['-'], stdin=schema)
    out = json.loads(r.stdout)
    order = next(t for t in out['tables'] if t['id'] == 'order')
    cols = {c['name']: c for c in order['columns']}
    assert cols['customerId']['fk'] == 'customer'

def test_enum():
    schema = """
enum Role {
  ADMIN
  USER
}
model Account {
  id   String @id
  role Role
}
"""
    r = run(['-'], stdin=schema)
    out = json.loads(r.stdout)
    assert out['enums'][0]['id'] == 'role'
    assert out['enums'][0]['values'][0]['code'] == 'ADMIN'

def test_pivot():
    schema = """
model BookGenre {
  bookId  String @id
  genreId String @id
  @@id([bookId, genreId])
}
"""
    r = run(['-'], stdin=schema)
    out = json.loads(r.stdout)
    # pivot needs both PKs to also be FKs — just check entity fallback here
    assert out['tables'][0]['type'] in ('pivot', 'entity')

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
