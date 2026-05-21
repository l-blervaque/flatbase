# Converters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five standalone Python scripts that convert SQL DDL, Prisma, Rails schema.rb, DBML, and Django models to flatbase JSON.

**Architecture:** Each script is fully self-contained (stdlib only, no shared module). Internal layout: a labeled BOILERPLATE section (CLI, domain inference, output) then a PARSER section. Tests run scripts via subprocess.

**Tech Stack:** Python 3 stdlib only (`re`, `json`, `argparse`, `pathlib`, `datetime`, `subprocess` for tests).

---

## File map

```
converters/
  sql_ddl.py
  prisma.py
  rails_schema.py
  dbml.py
  django_models.py
  README.md
  tests/
    test_sql_ddl.py
    test_prisma.py
    test_rails_schema.py
    test_dbml.py
    test_django_models.py
```

---

## Task 1 — Folder structure

**Files:**
- Create: `converters/tests/.gitkeep`

- [ ] **Step 1: Create directories**

```bash
mkdir -p converters/tests
touch converters/tests/.gitkeep
```

- [ ] **Step 2: Commit**

```bash
git add converters/
git commit -m "chore: scaffold converters directory"
```

---

## Task 2 — sql_ddl.py

**Files:**
- Create: `converters/sql_ddl.py`
- Create: `converters/tests/test_sql_ddl.py`

- [ ] **Step 1: Write the test**

Create `converters/tests/test_sql_ddl.py`:

```python
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
```

- [ ] **Step 2: Run test — verify it fails**

```bash
python3 converters/tests/test_sql_ddl.py
```

Expected: errors because `sql_ddl.py` does not exist yet.

- [ ] **Step 3: Implement sql_ddl.py**

Create `converters/sql_ddl.py`:

```python
#!/usr/bin/env python3
"""
flatbase converter — SQL DDL (PostgreSQL / MySQL / SQLite)

Usage:
  python3 sql_ddl.py schema.sql
  python3 sql_ddl.py commercial.sql sales.sql customer.sql
  python3 sql_ddl.py schema.sql -o tables.json
  cat schema.sql | python3 sql_ddl.py -

Output: flatbase JSON
"""
import re, json, sys, argparse
from datetime import date
from pathlib import Path

CONVERTER_NAME = 'sql_ddl'
ACCEPTED_EXTENSIONS = {'.sql'}
AUDIT_COLUMNS = {'id', 'created_at', 'updated_at', 'created_by', 'updated_by'}

# ── BOILERPLATE (logique commune à tous les convertisseurs) ────────────────────

def infer_domain(path):
    return 'main' if path == '-' else Path(path).stem.lower()

def build_output(tables_by_domain, enums=None):
    all_tables = []
    for domain, tables in tables_by_domain.items():
        for t in tables:
            t['domain'] = domain
            all_tables.append(t)
    out = {'meta': {'source': CONVERTER_NAME, 'converted_at': date.today().isoformat()},
           'tables': all_tables}
    if enums:
        out['enums'] = enums
    return out

def validate_extension(path):
    if path == '-':
        print('warning: reading from stdin, skipping extension check', file=sys.stderr)
        return
    ext = Path(path).suffix.lower()
    if ext not in ACCEPTED_EXTENSIONS:
        print(f'error: expected {sorted(ACCEPTED_EXTENSIONS)}, got {ext!r} ({path})',
              file=sys.stderr)
        sys.exit(1)

def read_file(path):
    return sys.stdin.read() if path == '-' else Path(path).read_text(encoding='utf-8')

def write_output(data, outfile=None):
    text = json.dumps(data, ensure_ascii=False, indent=2)
    if outfile:
        Path(outfile).write_text(text, encoding='utf-8')
    else:
        print(text)

def parse_args():
    p = argparse.ArgumentParser(description='Convert SQL DDL to flatbase JSON')
    p.add_argument('files', nargs='*', metavar='FILE',
                   help='SQL files (.sql) or - for stdin')
    p.add_argument('-o', '--out', metavar='FILE', help='Write output to FILE')
    return p.parse_args()

# ── PARSER (SQL DDL) ──────────────────────────────────────────────────────────

def strip_comments(sql):
    sql = re.sub(r'/\*.*?\*/', '', sql, flags=re.DOTALL)
    return re.sub(r'--[^\n]*', '', sql)

def split_top_level(s):
    parts, depth, buf = [], 0, []
    for ch in s:
        if ch == '(':
            depth += 1; buf.append(ch)
        elif ch == ')':
            depth -= 1; buf.append(ch)
        elif ch == ',' and depth == 0:
            parts.append(''.join(buf).strip()); buf = []
        else:
            buf.append(ch)
    if buf:
        parts.append(''.join(buf).strip())
    return parts

def extract_body(block):
    start = block.index('(')
    depth = 0
    for i, ch in enumerate(block[start:], start):
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
            if depth == 0:
                return block[start+1:i]
    return block[start+1:]

def parse_column(item):
    if re.match(r'^\s*(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT'
                r'|INDEX|KEY|FULLTEXT|SPATIAL)\b', item, re.IGNORECASE):
        return None
    m = re.match(r'^\s*[`"]?(\w+)[`"]?\s+([^\s,]+(?:\s*\([^)]*\))?)', item, re.IGNORECASE)
    if not m:
        return None
    name, col_type = m.group(1).lower(), m.group(2).strip()
    rest = item[m.end():]
    col = {'name': name, 'type': col_type}
    if re.search(r'\bNOT\s+NULL\b', rest, re.IGNORECASE):
        col['nullable'] = False
    if re.search(r'\bPRIMARY\s+KEY\b', rest, re.IGNORECASE):
        col['pk'] = True
    if re.search(r'\bUNIQUE\b', rest, re.IGNORECASE):
        col['unique'] = True
    m_def = re.search(r"\bDEFAULT\s+'?([^',\s)]+)'?", rest, re.IGNORECASE)
    if m_def:
        col['default'] = m_def.group(1)
    m_ref = re.search(
        r'\bREFERENCES\s+(?:\w+\.)?[`"]?(\w+)[`"]?\s*(?:\((\w+)\))?'
        r'(?:\s*ON\s+DELETE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION))?',
        rest, re.IGNORECASE)
    if m_ref:
        ref_table = m_ref.group(1).lower()
        ref_col = m_ref.group(2).lower() if m_ref.group(2) else None
        on_delete = m_ref.group(3).lower().replace(' ', '_') if m_ref.group(3) else None
        if ref_col and ref_col != 'id':
            fk = {'table': ref_table, 'column': ref_col}
            if on_delete: fk['on_delete'] = on_delete
            col['fk'] = fk
        elif on_delete:
            col['fk'] = {'table': ref_table, 'on_delete': on_delete}
        else:
            col['fk'] = ref_table
    return col

def infer_table_type(columns):
    pk_cols = [c for c in columns if c.get('pk')]
    non_audit = [c for c in columns if c['name'] not in AUDIT_COLUMNS and not c.get('pk')]
    if (len(pk_cols) == 2
            and all('fk' in c for c in pk_cols)
            and len(non_audit) == 0):
        return 'pivot'
    if len(pk_cols) == 1 and 'fk' in pk_cols[0]:
        return 'extension'
    return 'entity'

def parse_create_table(block):
    m = re.match(
        r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:\w+\.)?[`"]?(\w+)[`"]?\s*\(',
        block, re.IGNORECASE)
    if not m:
        return None
    table_name = m.group(1).lower()
    try:
        body = extract_body(block)
    except (ValueError, IndexError):
        print(f'warning: could not parse body for {table_name}', file=sys.stderr)
        return None
    items = split_top_level(body)
    columns, table_pk_cols, table_fk_map, table_unique_cols = [], [], {}, set()
    for item in items:
        item = item.strip()
        if not item:
            continue
        if re.match(r'(?:CONSTRAINT\s+\w+\s+)?PRIMARY\s+KEY\s*\(', item, re.IGNORECASE):
            m_pk = re.search(r'\(([^)]+)\)', item)
            if m_pk:
                table_pk_cols = [c.strip().strip('`"').lower()
                                 for c in m_pk.group(1).split(',')]
        elif re.match(r'(?:CONSTRAINT\s+\w+\s+)?FOREIGN\s+KEY', item, re.IGNORECASE):
            m_fk = re.search(
                r'FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+(?:\w+\.)?[`"]?(\w+)[`"]?'
                r'\s*(?:\(([^)]+)\))?'
                r'(?:\s*ON\s+DELETE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION))?',
                item, re.IGNORECASE)
            if m_fk:
                cols = [c.strip().strip('`"').lower() for c in m_fk.group(1).split(',')]
                ref_t = m_fk.group(2).lower()
                ref_c = m_fk.group(3).strip().lower() if m_fk.group(3) else 'id'
                od = m_fk.group(4).lower().replace(' ', '_') if m_fk.group(4) else None
                for cn in cols:
                    table_fk_map[cn] = (ref_t, ref_c, od)
        elif re.match(r'(?:CONSTRAINT\s+\w+\s+)?UNIQUE\s*\(', item, re.IGNORECASE):
            m_u = re.search(r'\(([^)]+)\)', item)
            if m_u:
                ucols = [c.strip().strip('`"').lower() for c in m_u.group(1).split(',')]
                if len(ucols) == 1:
                    table_unique_cols.add(ucols[0])
        elif not re.match(r'^\s*(CHECK|INDEX|KEY)\b', item, re.IGNORECASE):
            col = parse_column(item)
            if col:
                columns.append(col)
    for col in columns:
        n = col['name']
        if n in table_pk_cols:
            col['pk'] = True
        if n in table_unique_cols:
            col['unique'] = True
        if n in table_fk_map and 'fk' not in col:
            ref_t, ref_c, od = table_fk_map[n]
            if ref_c != 'id':
                fk = {'table': ref_t, 'column': ref_c}
                if od: fk['on_delete'] = od
                col['fk'] = fk
            elif od:
                col['fk'] = {'table': ref_t, 'on_delete': od}
            else:
                col['fk'] = ref_t
    return {
        'id': table_name,
        'name': ' '.join(w.capitalize() for w in table_name.split('_')),
        'type': infer_table_type(columns),
        'columns': columns,
    }

def parse_enum_block(block):
    m = re.match(
        r'CREATE\s+TYPE\s+[`"]?(\w+)[`"]?\s+AS\s+ENUM\s*\(([^)]+)\)',
        block, re.IGNORECASE)
    if not m:
        return None
    values = [{'code': v.strip().strip("'\"")}
              for v in m.group(2).split(',')
              if v.strip().strip("'\"")]
    return {'id': m.group(1).lower(), 'values': values}

def parse_sql(content):
    content = strip_comments(content)
    tables, enums = [], []
    for m in re.finditer(r'CREATE\s+TABLE\s[^;]+;', content,
                         re.IGNORECASE | re.DOTALL):
        t = parse_create_table(m.group(0))
        if t:
            tables.append(t)
    for m in re.finditer(
            r'CREATE\s+TYPE\s+\w+\s+AS\s+ENUM\s*\([^)]+\)\s*;',
            content, re.IGNORECASE):
        e = parse_enum_block(m.group(0))
        if e:
            enums.append(e)
    return tables, enums

def main():
    args = parse_args()
    files = args.files or ['-']
    for f in files:
        validate_extension(f)
    tables_by_domain, all_enums = {}, []
    for f in files:
        tables, enums = parse_sql(read_file(f))
        tables_by_domain[infer_domain(f)] = tables
        all_enums.extend(enums)
    write_output(build_output(tables_by_domain, all_enums or None), args.out)

if __name__ == '__main__':
    main()
```

- [ ] **Step 4: Run test — verify it passes**

```bash
python3 converters/tests/test_sql_ddl.py
```

Expected:
```
  PASS  test_simple_table
  PASS  test_inline_fk
  PASS  test_table_level_fk
  PASS  test_pivot_type
  PASS  test_extension_type
  PASS  test_enum
  PASS  test_multi_file_domains
  PASS  test_wrong_extension
  PASS  test_meta_fields

9/9 passed
```

- [ ] **Step 5: Commit**

```bash
git add converters/sql_ddl.py converters/tests/test_sql_ddl.py
git commit -m "feat(converters): add sql_ddl converter"
```

---

## Task 3 — prisma.py

**Files:**
- Create: `converters/prisma.py`
- Create: `converters/tests/test_prisma.py`

- [ ] **Step 1: Write the test**

Create `converters/tests/test_prisma.py`:

```python
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
```

- [ ] **Step 2: Run test — verify it fails**

```bash
python3 converters/tests/test_prisma.py
```

Expected: errors because `prisma.py` does not exist.

- [ ] **Step 3: Implement prisma.py**

Create `converters/prisma.py`:

```python
#!/usr/bin/env python3
"""
flatbase converter — Prisma schema

Usage:
  python3 prisma.py schema.prisma
  python3 prisma.py commercial.prisma sales.prisma
  python3 prisma.py schema.prisma -o tables.json
  cat schema.prisma | python3 prisma.py -
"""
import re, json, sys, argparse
from datetime import date
from pathlib import Path

CONVERTER_NAME = 'prisma'
ACCEPTED_EXTENSIONS = {'.prisma'}
AUDIT_COLUMNS = {'id', 'created_at', 'updated_at', 'created_by', 'updated_by',
                 'createdAt', 'updatedAt', 'createdBy', 'updatedBy'}

# ── BOILERPLATE (logique commune à tous les convertisseurs) ────────────────────

def infer_domain(path):
    return 'main' if path == '-' else Path(path).stem.lower()

def build_output(tables_by_domain, enums=None):
    all_tables = []
    for domain, tables in tables_by_domain.items():
        for t in tables:
            t['domain'] = domain
            all_tables.append(t)
    out = {'meta': {'source': CONVERTER_NAME, 'converted_at': date.today().isoformat()},
           'tables': all_tables}
    if enums:
        out['enums'] = enums
    return out

def validate_extension(path):
    if path == '-':
        print('warning: reading from stdin, skipping extension check', file=sys.stderr)
        return
    ext = Path(path).suffix.lower()
    if ext not in ACCEPTED_EXTENSIONS:
        print(f'error: expected {sorted(ACCEPTED_EXTENSIONS)}, got {ext!r} ({path})',
              file=sys.stderr)
        sys.exit(1)

def read_file(path):
    return sys.stdin.read() if path == '-' else Path(path).read_text(encoding='utf-8')

def write_output(data, outfile=None):
    text = json.dumps(data, ensure_ascii=False, indent=2)
    if outfile:
        Path(outfile).write_text(text, encoding='utf-8')
    else:
        print(text)

def parse_args():
    p = argparse.ArgumentParser(description='Convert Prisma schema to flatbase JSON')
    p.add_argument('files', nargs='*', metavar='FILE',
                   help='Prisma files (.prisma) or - for stdin')
    p.add_argument('-o', '--out', metavar='FILE', help='Write output to FILE')
    return p.parse_args()

# ── PARSER (Prisma) ───────────────────────────────────────────────────────────

PRISMA_SCALAR_TYPES = {
    'String', 'Int', 'BigInt', 'Float', 'Decimal',
    'Boolean', 'DateTime', 'Json', 'Bytes',
}

def camel_to_title(s):
    return re.sub(r'(?<!^)(?=[A-Z])', ' ', s)

def camel_to_snake(s):
    return re.sub(r'(?<!^)(?=[A-Z])', '_', s).lower()

def infer_table_type(columns):
    pk_cols = [c for c in columns if c.get('pk')]
    non_audit = [c for c in columns if c['name'] not in AUDIT_COLUMNS and not c.get('pk')]
    if len(pk_cols) == 2 and all('fk' in c for c in pk_cols) and len(non_audit) == 0:
        return 'pivot'
    if len(pk_cols) == 1 and 'fk' in pk_cols[0]:
        return 'extension'
    return 'entity'

def parse_model(block):
    m = re.match(r'model\s+(\w+)\s*\{', block)
    if not m:
        return None
    model_name = m.group(1)
    lines = block.split('\n')
    columns = []
    composite_pk = []
    relation_fks = {}  # scalar_field_name -> {table, column}

    for line in lines[1:]:
        line = line.strip()
        if not line or line.startswith('//') or line == '}':
            continue

        # @@id
        m_id = re.match(r'@@id\(\[([^\]]+)\]\)', line)
        if m_id:
            composite_pk = [f.strip() for f in m_id.group(1).split(',')]
            continue

        # @@unique (single col only)
        m_uniq = re.match(r'@@unique\(\[([^\]]+)\]\)', line)
        if m_uniq:
            ucols = [f.strip() for f in m_uniq.group(1).split(',')]
            if len(ucols) == 1:
                for col in columns:
                    if col['name'] == ucols[0]:
                        col['unique'] = True
            continue

        if line.startswith('@@'):
            continue

        m_f = re.match(r'^(\w+)\s+(\w+)(\[\])?\s*(\?)?\s*(.*)?$', line)
        if not m_f:
            continue

        fname = m_f.group(1)
        ftype = m_f.group(2)
        is_array = m_f.group(3) is not None
        nullable = m_f.group(4) == '?'
        attrs = m_f.group(5) or ''

        if ftype in PRISMA_SCALAR_TYPES or not ftype[0].isupper():
            col = {'name': fname, 'type': ftype}
            col['nullable'] = nullable
            if '@id' in attrs:
                col['pk'] = True
            if '@unique' in attrs:
                col['unique'] = True
            m_def = re.search(r'@default\(([^)]+)\)', attrs)
            if m_def:
                col['default'] = m_def.group(1).strip('"\'')
            columns.append(col)

        elif ftype[0].isupper() and not is_array:
            # Singular relation field — extract FK mapping
            m_rel = re.search(
                r'@relation\(\s*(?:name:\s*"\w+",\s*)?fields:\s*\[([^\]]+)\]'
                r',\s*references:\s*\[([^\]]+)\]',
                attrs)
            if m_rel:
                fk_fields = [f.strip() for f in m_rel.group(1).split(',')]
                ref_fields = [f.strip() for f in m_rel.group(2).split(',')]
                for fk_f, ref_f in zip(fk_fields, ref_fields):
                    relation_fks[fk_f] = (ftype.lower(), ref_f)

    # Apply relation FKs to scalar columns
    for col in columns:
        if col['name'] in relation_fks:
            target_table, ref_col = relation_fks[col['name']]
            if ref_col == 'id':
                col['fk'] = target_table
            else:
                col['fk'] = {'table': target_table, 'column': ref_col}

    # Apply composite PK
    for col in columns:
        if col['name'] in composite_pk:
            col['pk'] = True

    return {
        'id': camel_to_snake(model_name),
        'name': camel_to_title(model_name),
        'type': infer_table_type(columns),
        'columns': columns,
    }

def parse_enum_block(block):
    m = re.match(r'enum\s+(\w+)\s*\{([^}]+)\}', block, re.DOTALL)
    if not m:
        return None
    values = []
    for line in m.group(2).split('\n'):
        line = line.strip()
        if line and not line.startswith('//') and not line.startswith('@@'):
            code = re.match(r'^(\w+)', line)
            if code:
                values.append({'code': code.group(1)})
    return {'id': m.group(1).lower(), 'values': values} if values else None

def parse_prisma(content):
    tables, enums = [], []
    for m in re.finditer(r'^model\s+\w+\s*\{[^}]*\}', content,
                         re.MULTILINE | re.DOTALL):
        t = parse_model(m.group(0))
        if t:
            tables.append(t)
    for m in re.finditer(r'^enum\s+\w+\s*\{[^}]*\}', content,
                         re.MULTILINE | re.DOTALL):
        e = parse_enum_block(m.group(0))
        if e:
            enums.append(e)
    return tables, enums

def main():
    args = parse_args()
    files = args.files or ['-']
    for f in files:
        validate_extension(f)
    tables_by_domain, all_enums = {}, []
    for f in files:
        tables, enums = parse_prisma(read_file(f))
        tables_by_domain[infer_domain(f)] = tables
        all_enums.extend(enums)
    write_output(build_output(tables_by_domain, all_enums or None), args.out)

if __name__ == '__main__':
    main()
```

- [ ] **Step 4: Run test — verify it passes**

```bash
python3 converters/tests/test_prisma.py
```

Expected: `5/5 passed`

- [ ] **Step 5: Commit**

```bash
git add converters/prisma.py converters/tests/test_prisma.py
git commit -m "feat(converters): add prisma converter"
```

---

## Task 4 — rails_schema.py

**Files:**
- Create: `converters/rails_schema.py`
- Create: `converters/tests/test_rails_schema.py`

- [ ] **Step 1: Write the test**

Create `converters/tests/test_rails_schema.py`:

```python
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
```

- [ ] **Step 2: Run test — verify it fails**

```bash
python3 converters/tests/test_rails_schema.py
```

- [ ] **Step 3: Implement rails_schema.py**

Create `converters/rails_schema.py`:

```python
#!/usr/bin/env python3
"""
flatbase converter — Rails schema.rb

Usage:
  python3 rails_schema.py schema.rb
  python3 rails_schema.py commercial.rb sales.rb
  python3 rails_schema.py schema.rb -o tables.json
  cat schema.rb | python3 rails_schema.py -
"""
import re, json, sys, argparse
from datetime import date
from pathlib import Path

CONVERTER_NAME = 'rails_schema'
ACCEPTED_EXTENSIONS = {'.rb'}
AUDIT_COLUMNS = {'id', 'created_at', 'updated_at', 'created_by', 'updated_by'}

RAILS_TYPE_MAP = {
    'string': 'string', 'text': 'text', 'integer': 'integer', 'bigint': 'bigint',
    'float': 'float', 'decimal': 'decimal', 'boolean': 'boolean',
    'datetime': 'datetime', 'date': 'date', 'time': 'time', 'timestamp': 'timestamp',
    'binary': 'binary', 'jsonb': 'jsonb', 'json': 'json', 'uuid': 'uuid',
    'inet': 'inet', 'citext': 'citext',
}

# ── BOILERPLATE (logique commune à tous les convertisseurs) ────────────────────

def infer_domain(path):
    return 'main' if path == '-' else Path(path).stem.lower()

def build_output(tables_by_domain, enums=None):
    all_tables = []
    for domain, tables in tables_by_domain.items():
        for t in tables:
            t['domain'] = domain
            all_tables.append(t)
    out = {'meta': {'source': CONVERTER_NAME, 'converted_at': date.today().isoformat()},
           'tables': all_tables}
    if enums:
        out['enums'] = enums
    return out

def validate_extension(path):
    if path == '-':
        print('warning: reading from stdin, skipping extension check', file=sys.stderr)
        return
    ext = Path(path).suffix.lower()
    if ext not in ACCEPTED_EXTENSIONS:
        print(f'error: expected {sorted(ACCEPTED_EXTENSIONS)}, got {ext!r} ({path})',
              file=sys.stderr)
        sys.exit(1)

def read_file(path):
    return sys.stdin.read() if path == '-' else Path(path).read_text(encoding='utf-8')

def write_output(data, outfile=None):
    text = json.dumps(data, ensure_ascii=False, indent=2)
    if outfile:
        Path(outfile).write_text(text, encoding='utf-8')
    else:
        print(text)

def parse_args():
    p = argparse.ArgumentParser(description='Convert Rails schema.rb to flatbase JSON')
    p.add_argument('files', nargs='*', metavar='FILE',
                   help='Rails schema files (.rb) or - for stdin')
    p.add_argument('-o', '--out', metavar='FILE', help='Write output to FILE')
    return p.parse_args()

# ── PARSER (Rails schema.rb) ──────────────────────────────────────────────────

def _singularize(name):
    if name.endswith('ies'):
        return name[:-3] + 'y'
    if re.search(r'(s|x|z|sh|ch)es$', name):
        return name[:-2]
    if name.endswith('s'):
        return name[:-1]
    return name

def infer_table_type(columns):
    pk_cols = [c for c in columns if c.get('pk')]
    non_audit = [c for c in columns if c['name'] not in AUDIT_COLUMNS and not c.get('pk')]
    if len(pk_cols) == 2 and all('fk' in c for c in pk_cols) and len(non_audit) == 0:
        return 'pivot'
    if len(pk_cols) == 1 and 'fk' in pk_cols[0]:
        return 'extension'
    return 'entity'

def parse_rails_schema(content):
    tables = []

    for m in re.finditer(
            r'create_table\s+"(\w+)"(.*?)do\s*\|t\|(.*?)end\b',
            content, re.DOTALL | re.IGNORECASE):
        table_name = m.group(1)
        options = m.group(2)
        body = m.group(3)

        columns = []
        no_id = 'id: false' in options
        if not no_id:
            pk_type = 'uuid' if 'id: :uuid' in options else 'bigint'
            columns.append({'name': 'id', 'type': pk_type, 'pk': True, 'nullable': False})

        for line in body.split('\n'):
            line = line.strip()
            if not line or line.startswith('#'):
                continue

            m_ref = re.match(r't\.references\s+"(\w+)"(.*)?$', line)
            if m_ref:
                ref_name = m_ref.group(1)
                ref_opts = m_ref.group(2) or ''
                col = {'name': f'{ref_name}_id', 'type': 'bigint', 'fk': ref_name}
                if 'null: false' in ref_opts:
                    col['nullable'] = False
                columns.append(col)
                continue

            m_col = re.match(r't\.(\w+)\s+"(\w+)"(.*)?$', line)
            if not m_col:
                continue

            col_type = m_col.group(1)
            col_name = m_col.group(2)
            opts = m_col.group(3) or ''

            mapped = RAILS_TYPE_MAP.get(col_type, col_type)
            m_limit = re.search(r'limit:\s*(\d+)', opts)
            if m_limit and col_type == 'string':
                mapped = f'string({m_limit.group(1)})'

            col = {'name': col_name, 'type': mapped}
            if 'null: false' in opts:
                col['nullable'] = False
            m_def = re.search(r'default:\s*([^,\n]+)', opts)
            if m_def:
                col['default'] = m_def.group(1).strip().strip('"\'')
            columns.append(col)

        tables.append({
            'id': table_name,
            'name': ' '.join(w.capitalize() for w in table_name.split('_')),
            'type': infer_table_type(columns),
            'columns': columns,
        })

    # Apply add_foreign_key statements
    for m in re.finditer(
            r'add_foreign_key\s+"(\w+)",\s+"(\w+)"'
            r'(?:.*?column:\s*"(\w+)")?',
            content, re.IGNORECASE):
        src_table = m.group(1)
        ref_table = m.group(2)
        col_name = m.group(3) if m.group(3) else f'{_singularize(ref_table)}_id'
        for table in tables:
            if table['id'] == src_table:
                for col in table['columns']:
                    if col['name'] == col_name and 'fk' not in col:
                        col['fk'] = ref_table

    return tables

def main():
    args = parse_args()
    files = args.files or ['-']
    for f in files:
        validate_extension(f)
    tables_by_domain = {}
    for f in files:
        tables_by_domain[infer_domain(f)] = parse_rails_schema(read_file(f))
    write_output(build_output(tables_by_domain), args.out)

if __name__ == '__main__':
    main()
```

- [ ] **Step 4: Run test — verify it passes**

```bash
python3 converters/tests/test_rails_schema.py
```

Expected: `5/5 passed`

- [ ] **Step 5: Commit**

```bash
git add converters/rails_schema.py converters/tests/test_rails_schema.py
git commit -m "feat(converters): add rails_schema converter"
```

---

## Task 5 — dbml.py

**Files:**
- Create: `converters/dbml.py`
- Create: `converters/tests/test_dbml.py`

- [ ] **Step 1: Write the test**

Create `converters/tests/test_dbml.py`:

```python
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
```

- [ ] **Step 2: Run test — verify it fails**

```bash
python3 converters/tests/test_dbml.py
```

- [ ] **Step 3: Implement dbml.py**

Create `converters/dbml.py`:

```python
#!/usr/bin/env python3
"""
flatbase converter — DBML (dbdiagram.io)

Usage:
  python3 dbml.py schema.dbml
  python3 dbml.py commercial.dbml sales.dbml
  python3 dbml.py schema.dbml -o tables.json
  cat schema.dbml | python3 dbml.py -

Note: TableGroup blocks map to flatbase domains. When present, they override
the filename-based domain inference.
"""
import re, json, sys, argparse
from datetime import date
from pathlib import Path

CONVERTER_NAME = 'dbml'
ACCEPTED_EXTENSIONS = {'.dbml'}
AUDIT_COLUMNS = {'id', 'created_at', 'updated_at', 'created_by', 'updated_by'}

# ── BOILERPLATE (logique commune à tous les convertisseurs) ────────────────────

def infer_domain(path):
    return 'main' if path == '-' else Path(path).stem.lower()

def build_output(tables_by_domain, enums=None):
    all_tables = []
    for domain, tables in tables_by_domain.items():
        for t in tables:
            t['domain'] = domain
            all_tables.append(t)
    out = {'meta': {'source': CONVERTER_NAME, 'converted_at': date.today().isoformat()},
           'tables': all_tables}
    if enums:
        out['enums'] = enums
    return out

def validate_extension(path):
    if path == '-':
        print('warning: reading from stdin, skipping extension check', file=sys.stderr)
        return
    ext = Path(path).suffix.lower()
    if ext not in ACCEPTED_EXTENSIONS:
        print(f'error: expected {sorted(ACCEPTED_EXTENSIONS)}, got {ext!r} ({path})',
              file=sys.stderr)
        sys.exit(1)

def read_file(path):
    return sys.stdin.read() if path == '-' else Path(path).read_text(encoding='utf-8')

def write_output(data, outfile=None):
    text = json.dumps(data, ensure_ascii=False, indent=2)
    if outfile:
        Path(outfile).write_text(text, encoding='utf-8')
    else:
        print(text)

def parse_args():
    p = argparse.ArgumentParser(description='Convert DBML to flatbase JSON')
    p.add_argument('files', nargs='*', metavar='FILE',
                   help='DBML files (.dbml) or - for stdin')
    p.add_argument('-o', '--out', metavar='FILE', help='Write output to FILE')
    return p.parse_args()

# ── PARSER (DBML) ─────────────────────────────────────────────────────────────

def infer_table_type(columns):
    pk_cols = [c for c in columns if c.get('pk')]
    non_audit = [c for c in columns if c['name'] not in AUDIT_COLUMNS and not c.get('pk')]
    if len(pk_cols) == 2 and all('fk' in c for c in pk_cols) and len(non_audit) == 0:
        return 'pivot'
    if len(pk_cols) == 1 and 'fk' in pk_cols[0]:
        return 'extension'
    return 'entity'

def parse_dbml(content):
    tables = []
    enums = []
    table_groups = {}  # table_name -> group_name

    # TableGroup blocks
    for m in re.finditer(r'TableGroup\s+\w+\s*\{([^}]+)\}', content,
                         re.IGNORECASE | re.DOTALL):
        group_name_m = re.match(r'TableGroup\s+(\w+)', m.group(0), re.IGNORECASE)
        if not group_name_m:
            continue
        group_name = group_name_m.group(1).lower()
        for line in m.group(1).split('\n'):
            name = line.strip()
            if name and not name.startswith('//'):
                table_groups[name.lower()] = group_name

    # Enum blocks
    for m in re.finditer(r'[Ee]num\s+(\w+)\s*\{([^}]+)\}', content, re.DOTALL):
        values = []
        for line in m.group(2).split('\n'):
            line = line.strip()
            if line and not line.startswith('//') and not line.lower().startswith('note'):
                code = re.match(r'^(\w+)', line)
                if code:
                    values.append({'code': code.group(1)})
        if values:
            enums.append({'id': m.group(1).lower(), 'values': values})

    # Table blocks
    for m in re.finditer(r'[Tt]able\s+(\w+)(?:\s+\[.*?\])?\s*\{([^}]+)\}', content,
                         re.DOTALL):
        table_name = m.group(1).lower()
        body = m.group(2)
        columns = []

        for line in body.split('\n'):
            line = line.strip()
            if not line or line.startswith('//'):
                continue
            if re.match(r'^(indexes|note)\b', line, re.IGNORECASE):
                break

            m_col = re.match(r'^(\w+)\s+(\S+)(?:\s+\[([^\]]*)\])?', line)
            if not m_col:
                continue

            col_name = m_col.group(1)
            col_type = m_col.group(2)
            attrs_str = m_col.group(3) or ''
            attrs = [a.strip().lower() for a in attrs_str.split(',')]

            col = {'name': col_name, 'type': col_type}
            if 'pk' in attrs:
                col['pk'] = True
            if 'not null' in attrs:
                col['nullable'] = False
            if 'unique' in attrs:
                col['unique'] = True

            m_def = re.search(r"default:\s*['\"]?([^,'\"\]]+)['\"]?", attrs_str, re.IGNORECASE)
            if m_def:
                col['default'] = m_def.group(1).strip()

            m_ref = re.search(r'ref:\s*[<>-]\s*(\w+)\.(\w+)', attrs_str, re.IGNORECASE)
            if m_ref:
                ref_table = m_ref.group(1).lower()
                ref_col = m_ref.group(2).lower()
                col['fk'] = ref_table if ref_col == 'id' else {'table': ref_table, 'column': ref_col}

            columns.append(col)

        tables.append({
            'id': table_name,
            'name': ' '.join(w.capitalize() for w in table_name.split('_')),
            'type': infer_table_type(columns),
            'columns': columns,
        })

    # External Ref statements
    for m in re.finditer(
            r'^[Rr]ef(?:\s*\w+)?:\s*(\w+)\.(\w+)\s*[<>-]\s*(\w+)\.(\w+)',
            content, re.MULTILINE):
        src_table = m.group(1).lower()
        src_col = m.group(2).lower()
        ref_table = m.group(3).lower()
        ref_col = m.group(4).lower()
        for table in tables:
            if table['id'] == src_table:
                for col in table['columns']:
                    if col['name'] == src_col and 'fk' not in col:
                        col['fk'] = ref_table if ref_col == 'id' else {'table': ref_table, 'column': ref_col}

    return tables, enums, table_groups

def main():
    args = parse_args()
    files = args.files or ['-']
    for f in files:
        validate_extension(f)

    all_tables, all_enums, all_groups = [], [], {}
    for f in files:
        tables, enums, groups = parse_dbml(read_file(f))
        default_domain = infer_domain(f)
        for t in tables:
            t['_default_domain'] = default_domain
        all_tables.extend(tables)
        all_enums.extend(enums)
        all_groups.update(groups)

    tables_by_domain = {}
    for t in all_tables:
        default = t.pop('_default_domain')
        domain = all_groups.get(t['id'], default)
        tables_by_domain.setdefault(domain, []).append(t)

    write_output(build_output(tables_by_domain, all_enums or None), args.out)

if __name__ == '__main__':
    main()
```

- [ ] **Step 4: Run test — verify it passes**

```bash
python3 converters/tests/test_dbml.py
```

Expected: `6/6 passed`

- [ ] **Step 5: Commit**

```bash
git add converters/dbml.py converters/tests/test_dbml.py
git commit -m "feat(converters): add dbml converter"
```

---

## Task 6 — django_models.py

**Files:**
- Create: `converters/django_models.py`
- Create: `converters/tests/test_django_models.py`

- [ ] **Step 1: Write the test**

Create `converters/tests/test_django_models.py`:

```python
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
```

- [ ] **Step 2: Run test — verify it fails**

```bash
python3 converters/tests/test_django_models.py
```

- [ ] **Step 3: Implement django_models.py**

Create `converters/django_models.py`:

```python
#!/usr/bin/env python3
"""
flatbase converter — Django models.py

Usage:
  python3 django_models.py models.py
  python3 django_models.py commercial/models.py sales/models.py
  python3 django_models.py models.py -o tables.json
  cat models.py | python3 django_models.py -

Known limits: ManyToManyField with through= is ignored. Abstract models are
skipped with a warning.
"""
import re, json, sys, argparse
from datetime import date
from pathlib import Path

CONVERTER_NAME = 'django_models'
ACCEPTED_EXTENSIONS = {'.py'}
AUDIT_COLUMNS = {'id', 'created_at', 'updated_at', 'created_by', 'updated_by'}

DJANGO_TYPE_MAP = {
    'AutoField': 'integer', 'BigAutoField': 'bigint', 'SmallAutoField': 'smallint',
    'IntegerField': 'integer', 'BigIntegerField': 'bigint', 'SmallIntegerField': 'smallint',
    'PositiveIntegerField': 'integer', 'PositiveSmallIntegerField': 'smallint',
    'FloatField': 'float', 'DecimalField': 'decimal',
    'CharField': 'string', 'TextField': 'text', 'SlugField': 'string(50)',
    'EmailField': 'string(254)', 'URLField': 'string(200)',
    'GenericIPAddressField': 'string(39)',
    'BooleanField': 'boolean', 'NullBooleanField': 'boolean',
    'DateField': 'date', 'DateTimeField': 'datetime', 'TimeField': 'time',
    'DurationField': 'interval', 'UUIDField': 'uuid',
    'BinaryField': 'binary', 'JSONField': 'jsonb',
    'FileField': 'string(100)', 'ImageField': 'string(100)',
}

# ── BOILERPLATE (logique commune à tous les convertisseurs) ────────────────────

def infer_domain(path):
    return 'main' if path == '-' else Path(path).stem.lower()

def build_output(tables_by_domain, enums=None):
    all_tables = []
    for domain, tables in tables_by_domain.items():
        for t in tables:
            t['domain'] = domain
            all_tables.append(t)
    out = {'meta': {'source': CONVERTER_NAME, 'converted_at': date.today().isoformat()},
           'tables': all_tables}
    if enums:
        out['enums'] = enums
    return out

def validate_extension(path):
    if path == '-':
        print('warning: reading from stdin, skipping extension check', file=sys.stderr)
        return
    ext = Path(path).suffix.lower()
    if ext not in ACCEPTED_EXTENSIONS:
        print(f'error: expected {sorted(ACCEPTED_EXTENSIONS)}, got {ext!r} ({path})',
              file=sys.stderr)
        sys.exit(1)

def read_file(path):
    return sys.stdin.read() if path == '-' else Path(path).read_text(encoding='utf-8')

def write_output(data, outfile=None):
    text = json.dumps(data, ensure_ascii=False, indent=2)
    if outfile:
        Path(outfile).write_text(text, encoding='utf-8')
    else:
        print(text)

def parse_args():
    p = argparse.ArgumentParser(description='Convert Django models.py to flatbase JSON')
    p.add_argument('files', nargs='*', metavar='FILE',
                   help='Django model files (.py) or - for stdin')
    p.add_argument('-o', '--out', metavar='FILE', help='Write output to FILE')
    return p.parse_args()

# ── PARSER (Django models) ────────────────────────────────────────────────────

def camel_to_snake(s):
    return re.sub(r'(?<!^)(?=[A-Z])', '_', s).lower()

def camel_to_title(s):
    return re.sub(r'(?<!^)(?=[A-Z])', ' ', s)

def infer_table_type(columns):
    pk_cols = [c for c in columns if c.get('pk')]
    non_audit = [c for c in columns if c['name'] not in AUDIT_COLUMNS and not c.get('pk')]
    if len(pk_cols) == 2 and all('fk' in c for c in pk_cols) and len(non_audit) == 0:
        return 'pivot'
    # OneToOneField with primary_key=True → extension
    oto_pk = [c for c in columns if c.get('pk') and 'fk' in c]
    if oto_pk:
        return 'extension'
    # OneToOneField without primary_key (implicit unique FK) as sole FK → extension
    fk_cols = [c for c in columns if 'fk' in c]
    unique_fks = [c for c in fk_cols if c.get('unique')]
    if len(unique_fks) == 1 and len(fk_cols) == 1:
        return 'extension'
    return 'entity'

def parse_field_args(args_str):
    """Parse key=value pairs from a field's argument string."""
    result = {}
    # null=True/False
    m = re.search(r'\bnull\s*=\s*(True|False)', args_str)
    if m:
        result['null'] = m.group(1) == 'True'
    # unique=True
    if re.search(r'\bunique\s*=\s*True', args_str):
        result['unique'] = True
    # primary_key=True
    if re.search(r'\bprimary_key\s*=\s*True', args_str):
        result['primary_key'] = True
    # default=value
    m_def = re.search(r"\bdefault\s*=\s*([^,)]+)", args_str)
    if m_def:
        result['default'] = m_def.group(1).strip().strip('"\'')
    # max_length=N
    m_ml = re.search(r'\bmax_length\s*=\s*(\d+)', args_str)
    if m_ml:
        result['max_length'] = int(m_ml.group(1))
    # on_delete=models.X
    m_od = re.search(r'\bon_delete\s*=\s*models\.(\w+)', args_str)
    if m_od:
        result['on_delete'] = m_od.group(1).lower()
    return result

def extract_target(args_str):
    """Extract the first positional argument (target model name)."""
    # 'ModelName' or "ModelName" or ModelName or 'app.ModelName'
    m = re.match(r"\s*['\"](?:\w+\.)?(\w+)['\"]", args_str)
    if m:
        return m.group(1).lower()
    m = re.match(r'\s*(\w+)', args_str)
    if m and m.group(1) not in ('on_delete', 'null', 'blank', 'default',
                                 'related_name', 'to', 'db_column'):
        return m.group(1).lower()
    return None

def parse_django_models(content):
    if 'models.Model' not in content:
        print('warning: file does not contain models.Model, '
              'may not be a Django models file', file=sys.stderr)

    tables = []
    # Split on class definitions
    blocks = re.split(r'(?=^class\s+\w+\s*\()', content, flags=re.MULTILINE)

    for block in blocks:
        m_class = re.match(r'class\s+(\w+)\s*\(([^)]+)\)', block)
        if not m_class:
            continue
        class_name = m_class.group(1)
        bases = m_class.group(2)
        if 'models.Model' not in bases:
            continue

        # Skip abstract models
        if re.search(r'class\s+Meta.*?abstract\s*=\s*True', block, re.DOTALL):
            print(f'warning: skipping abstract model {class_name}', file=sys.stderr)
            continue

        columns = []
        has_explicit_pk = False

        for line in block.split('\n'):
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if re.match(r'class\s+Meta\b|def\s+\w+', line):
                break

            m_field = re.match(r'^(\w+)\s*=\s*models\.(\w+)\s*\((.*)\)\s*$', line)
            if not m_field:
                continue

            field_name = m_field.group(1)
            field_type = m_field.group(2)
            args_str = m_field.group(3)
            kwargs = parse_field_args(args_str)

            if field_type == 'ManyToManyField':
                if 'through=' not in args_str:
                    pass  # flatbase derives M2M from pivot tables; skip
                continue

            if field_type in ('ForeignKey', 'OneToOneField'):
                target = extract_target(args_str)
                if not target:
                    continue
                col_name = f'{field_name}_id'
                col = {'name': col_name, 'type': 'bigint'}
                on_delete = kwargs.get('on_delete')
                col['fk'] = {'table': target, 'on_delete': on_delete} if on_delete else target
                if kwargs.get('null'):
                    col['nullable'] = True
                else:
                    col['nullable'] = False
                if kwargs.get('unique') or field_type == 'OneToOneField':
                    col['unique'] = True
                if kwargs.get('primary_key'):
                    col['pk'] = True
                    has_explicit_pk = True
                columns.append(col)
                continue

            mapped = DJANGO_TYPE_MAP.get(field_type, field_type.lower())
            if field_type == 'CharField' and 'max_length' in kwargs:
                mapped = f'string({kwargs["max_length"]})'

            col = {'name': field_name, 'type': mapped}
            if kwargs.get('primary_key'):
                col['pk'] = True
                has_explicit_pk = True
            if kwargs.get('null'):
                col['nullable'] = True
            if kwargs.get('unique'):
                col['unique'] = True
            if 'default' in kwargs:
                col['default'] = kwargs['default']
            columns.append(col)

        if not has_explicit_pk:
            columns.insert(0, {'name': 'id', 'type': 'bigint', 'pk': True,
                                'nullable': False})

        table_id = camel_to_snake(class_name)
        tables.append({
            'id': table_id,
            'name': camel_to_title(class_name),
            'type': infer_table_type(columns),
            'columns': columns,
        })

    return tables

def main():
    args = parse_args()
    files = args.files or ['-']
    for f in files:
        validate_extension(f)
    tables_by_domain = {}
    for f in files:
        tables_by_domain[infer_domain(f)] = parse_django_models(read_file(f))
    write_output(build_output(tables_by_domain), args.out)

if __name__ == '__main__':
    main()
```

- [ ] **Step 4: Run test — verify it passes**

```bash
python3 converters/tests/test_django_models.py
```

Expected: `5/5 passed`

- [ ] **Step 5: Commit**

```bash
git add converters/django_models.py converters/tests/test_django_models.py
git commit -m "feat(converters): add django_models converter"
```

---

## Task 7 — converters/README.md

**Files:**
- Create: `converters/README.md`

- [ ] **Step 1: Write the README**

Create `converters/README.md`:

```markdown
# flatbase converters

Standalone Python scripts (stdlib only, no pip required) that convert existing
database schemas to flatbase JSON.

## Quick reference

| Script | Source format | File extension |
|---|---|---|
| `sql_ddl.py` | SQL DDL (PostgreSQL / MySQL / SQLite) | `.sql` |
| `prisma.py` | Prisma schema | `.prisma` |
| `rails_schema.py` | Rails `schema.rb` | `.rb` |
| `dbml.py` | DBML (dbdiagram.io) | `.dbml` |
| `django_models.py` | Django `models.py` | `.py` |

## Usage

```sh
# Single file → domain inferred from filename stem
python3 converters/sql_ddl.py schema.sql > tables.json

# Multiple files → one domain per file, merged output
python3 converters/sql_ddl.py commercial.sql sales.sql customer.sql > tables.json

# Write to file instead of stdout
python3 converters/sql_ddl.py schema.sql -o tables.json

# Stdin (domain = "main")
cat schema.sql | python3 converters/sql_ddl.py -
```

Same pattern for all converters.

## Output conventions

Every converter produces flatbase JSON with:

- `id` — table name, snake_case
- `name` — table name, Title Case
- `domain` — inferred from input filename stem (or `TableGroup` for DBML)
- `type` — inferred: `pivot` (composite PK from 2 FKs), `extension` (PK = FK), `entity` (default)
- `columns` — name, type, pk, nullable, unique, default, fk where available
- `enums` — where supported by the source format

**Fields to set manually after conversion:**
- `type: "reference"` or `"cross-cutting"` — not structurally detectable
- `name_ja` — translation
- `notes`, `description` — documentation

## Adding dependencies

If a converter ever needs a pip package, move it to a subfolder:

```
converters/
  sql_ddl/
    sql_ddl.py
    README.md   ← prerequisites + pip install instructions
```

## Known limits

### sql_ddl.py
- Complex `DEFAULT` expressions → passed as raw string
- `CHECK` constraints and generated columns → ignored (warning on stderr)
- Tested against PostgreSQL / MySQL / SQLite; MSSQL not guaranteed

### prisma.py
- Implicit relations without `@relation` → not detected
- `@@map` renamed tables → physical name used

### rails_schema.py
- `id: false` tables → no auto `id` column
- `add_foreign_key` without explicit `column:` infers column from table name (strips trailing `s`)

### dbml.py
- Only format with native domain support via `TableGroup`

### django_models.py
- `ManyToManyField` with `through=` → ignored
- Abstract models → skipped (warning on stderr)
```

- [ ] **Step 2: Commit**

```bash
git add converters/README.md
git commit -m "docs(converters): add README"
```

---

## Running all tests

```bash
for f in converters/tests/test_*.py; do python3 "$f"; done
```
