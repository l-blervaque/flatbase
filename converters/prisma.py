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
    relation_fks = {}  # scalar_field_name -> (target_table, ref_col)

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
            # Singular relation field — extract FK mapping from @relation
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
        domain = infer_domain(f)
        if domain in tables_by_domain:
            print(f'warning: duplicate domain {domain!r} from {f!r}, overwriting previous',
                  file=sys.stderr)
        tables_by_domain[domain] = tables
        all_enums.extend(enums)
    write_output(build_output(tables_by_domain, all_enums or None), args.out)

if __name__ == '__main__':
    main()
