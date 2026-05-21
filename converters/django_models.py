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
            all_tables.append({**t, 'domain': domain})
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

# ── PARSER (spécifique à ce format) ─────────────────────────────────────────

def camel_to_snake(s):
    return re.sub(r'(?<!^)(?=[A-Z])', '_', s).lower()

def camel_to_title(s):
    return re.sub(r'(?<!^)(?=[A-Z])', ' ', s)

def infer_table_type(columns):
    pk_cols = [c for c in columns if c.get('pk')]
    non_audit = [c for c in columns if c['name'] not in AUDIT_COLUMNS and not c.get('pk')]
    if len(pk_cols) == 2 and all('fk' in c for c in pk_cols) and len(non_audit) == 0:
        return 'pivot'
    if len(pk_cols) == 1 and 'fk' in pk_cols[0]:
        return 'extension'
    return 'entity'

def parse_field_args(args_str):
    result = {}
    m = re.search(r'\bnull\s*=\s*(True|False)', args_str)
    if m:
        result['null'] = m.group(1) == 'True'
    if re.search(r'\bunique\s*=\s*True', args_str):
        result['unique'] = True
    if re.search(r'\bprimary_key\s*=\s*True', args_str):
        result['primary_key'] = True
    m_def = re.search(r"\bdefault\s*=\s*([^,)]+)", args_str)
    if m_def:
        result['default'] = m_def.group(1).strip().strip('"\'')
    m_ml = re.search(r'\bmax_length\s*=\s*(\d+)', args_str)
    if m_ml:
        result['max_length'] = int(m_ml.group(1))
    m_od = re.search(r'\bon_delete\s*=\s*models\.(\w+)', args_str)
    if m_od:
        result['on_delete'] = m_od.group(1).lower()
    return result

def extract_target(args_str):
    # 'self' FK — not representable in flatbase
    if args_str.strip().startswith(("'self'", '"self"')) or re.search(r'\bto\s*=\s*[\'"]self[\'"]', args_str):
        print('warning: self-referential ForeignKey skipped', file=sys.stderr)
        return None
    # to= keyword form (common in real Django projects)
    m = re.search(r'\bto\s*=\s*[\'"](?:\w+\.)?(\w+)[\'"]', args_str)
    if m:
        return m.group(1).lower()
    m = re.search(r'\bto\s*=\s*(\w+)', args_str)
    if m and m.group(1) not in ('None', 'null', 'self'):
        return m.group(1).lower()
    # Positional string or bare class name
    m = re.match(r"\s*['\"](?:\w+\.)?(\w+)['\"]", args_str)
    if m:
        return m.group(1).lower()
    m = re.match(r'\s*(\w+)', args_str)
    if m and m.group(1) not in ('on_delete', 'null', 'blank', 'default',
                                 'related_name', 'to', 'db_column'):
        return m.group(1).lower()
    return None

def join_logical_lines(text):
    result = []
    buf = ''
    depth = 0
    for line in text.split('\n'):
        stripped = line.strip()
        if buf:
            buf += ' ' + stripped
        else:
            buf = line
        depth += stripped.count('(') - stripped.count(')')
        if depth <= 0:
            result.append(buf)
            buf = ''
            depth = 0
    if buf:
        result.append(buf)
    return '\n'.join(result)

def parse_django_models(content):
    if 'models.Model' not in content:
        print('warning: file does not contain models.Model, '
              'may not be a Django models file', file=sys.stderr)

    tables = []
    blocks = re.split(r'(?=^class\s+\w+\s*\()', content, flags=re.MULTILINE)

    for block in blocks:
        m_class = re.match(r'class\s+(\w+)\s*\(([^)]+)\)', block)
        if not m_class:
            continue
        class_name = m_class.group(1)
        bases = m_class.group(2)
        if 'models.Model' not in bases:
            continue

        if re.search(r'class\s+Meta.*?abstract\s*=\s*True', block, re.DOTALL):
            print(f'warning: skipping abstract model {class_name}', file=sys.stderr)
            continue

        columns = []
        has_explicit_pk = False

        # join continuation lines so multi-line field defs are handled
        block = join_logical_lines(block)

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
                print(f'warning: ManyToManyField {field_name!r} skipped (not representable in flatbase)', file=sys.stderr)
                continue

            if field_type in ('ForeignKey', 'OneToOneField'):
                target = extract_target(args_str)
                if not target:
                    continue
                col_name = f'{field_name}_id'
                col = {'name': col_name, 'type': 'bigint'}
                on_delete = kwargs.get('on_delete')
                col['fk'] = {'table': target, 'on_delete': on_delete} if on_delete else target
                if 'null' in kwargs:
                    col['nullable'] = kwargs['null']
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
            if 'null' in kwargs:
                col['nullable'] = kwargs['null']
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
        domain = infer_domain(f)
        if domain in tables_by_domain:
            print(f'warning: duplicate domain {domain!r} from {f!r}, overwriting', file=sys.stderr)
        tables_by_domain[domain] = parse_django_models(read_file(f))
    write_output(build_output(tables_by_domain), args.out)

if __name__ == '__main__':
    main()
