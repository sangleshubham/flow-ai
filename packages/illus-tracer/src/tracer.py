"""Trusted sys.settrace harness; user source is compiled under filename <user>.

The restricted algorithm subset is intentionally narrower than general Python. The worker's
network removal and hard main-thread termination remain independent boundaries.
"""
import ast as _ast
import builtins as _builtins
import json as _json
import math as _math
import sys as _sys
import traceback as _traceback
import importlib as _importlib

_ALLOWED = ('collections', 'heapq', 'bisect', 'math', 'itertools', 'functools',
            'dataclasses', 'typing', 'string', 'random')
# Preload stdlib dependencies while the trusted harness can import them; user imports cannot
# trigger package loading or access a submodule through the custom importer.
_MODULES = {name: _importlib.import_module(name) for name in _ALLOWED}
_sys.modules['js'] = None
_sys.modules['pyodide_js'] = None
_sys.modules.pop('micropip', None)
_EXPORTS = {
    'collections': ('deque', 'Counter', 'defaultdict', 'OrderedDict', 'namedtuple'),
    'heapq': ('heappush', 'heappop', 'heapify', 'heapreplace', 'heappushpop', 'nlargest', 'nsmallest', 'merge'),
    'bisect': ('bisect', 'bisect_left', 'bisect_right', 'insort', 'insort_left', 'insort_right'),
    'math': tuple(name for name in dir(_MODULES['math']) if not name.startswith('_')),
    'itertools': ('accumulate', 'chain', 'combinations', 'combinations_with_replacement', 'count', 'cycle', 'dropwhile', 'filterfalse', 'groupby', 'islice', 'pairwise', 'permutations', 'product', 'repeat', 'starmap', 'takewhile', 'zip_longest'),
    'functools': ('cache', 'lru_cache', 'cmp_to_key', 'partial'),
    'dataclasses': ('dataclass', 'field', 'fields', 'asdict', 'astuple', 'replace', 'is_dataclass'),
    'typing': ('Any', 'List', 'Dict', 'Tuple', 'Set', 'Optional', 'Union', 'Iterable', 'Iterator', 'Sequence', 'Mapping', 'Callable', 'Deque', 'NamedTuple'),
    'string': ('ascii_letters', 'ascii_lowercase', 'ascii_uppercase', 'digits', 'hexdigits', 'octdigits', 'punctuation', 'whitespace'),
    'random': ('random', 'randint', 'randrange', 'choice', 'choices', 'shuffle', 'sample', 'uniform', 'seed'),
}

class _SafeModule:
    def __init__(self, name):
        _builtins.object.__setattr__(self, '_name', name)
    def __getattr__(self, name):
        module = _builtins.object.__getattribute__(self, '_name')
        if name not in _EXPORTS[module]:
            raise AttributeError('module attribute not allowed: ' + name)
        return getattr(_MODULES[module], name)
    def __setattr__(self, name, value):
        raise AttributeError('module mutation not allowed')
_DENIED = {'open', 'exec', 'eval', 'compile', 'input', 'breakpoint', 'globals', 'locals',
           'vars', 'dir', 'getattr', 'setattr', 'delattr', 'hasattr', 'type', 'object',
           'help', 'memoryview', 'classmethod', 'staticmethod', 'super', 'property',
           'f_globals', 'f_locals', 'f_builtins', 'f_back', 'f_code', 'tb_frame',
           'tb_next', 'gi_frame', 'gi_code', 'cr_frame', 'ag_frame', 'mro',
           'func_globals', 'reduce', 'load', 'loads', 'dump', 'dumps'}

def _validate(tree):
    for node in _ast.walk(tree):
        if isinstance(node, (_ast.AsyncFunctionDef, _ast.Await, _ast.Yield, _ast.YieldFrom,
                             _ast.Global, _ast.Nonlocal, _ast.Delete)):
            raise ValueError('blocked Python construct: ' + node.__class__.__name__)
        if isinstance(node, _ast.Name) and (node.id.startswith('_') or node.id in _DENIED):
            raise ValueError('blocked name: ' + node.id)
        if isinstance(node, _ast.Attribute) and (node.attr.startswith('_') or node.attr in _DENIED):
            raise ValueError('blocked attribute: ' + node.attr)
        if isinstance(node, (_ast.FunctionDef, _ast.ClassDef)):
            if node.name.startswith('_') and node.name != '__init__':
                raise ValueError('blocked definition: ' + node.name)
        if isinstance(node, _ast.Import):
            for alias in node.names:
                if alias.name not in _ALLOWED or (alias.asname and alias.asname.startswith('_')):
                    raise ValueError('import not allowed: ' + alias.name)
        if isinstance(node, _ast.ImportFrom):
            if node.level or node.module not in _ALLOWED:
                raise ValueError('import not allowed: ' + str(node.module))
            for alias in node.names:
                if alias.name.startswith('_') or alias.name == '*' or (alias.asname and alias.asname.startswith('_')):
                    raise ValueError('import not allowed: ' + alias.name)

class _LineLimit(BaseException):
    pass

def _trace_json(request_json):
    request = _json.loads(request_json)
    steps, stdout = [], ''
    line_events, truncated = 0, False
    focus = set(request['focusFunctions'])
    _sys.setrecursionlimit(200)
    _MODULES['random'].seed(0)

    def output(*values, sep=' ', end='\n', file=None, flush=False):
        nonlocal stdout
        if file is not None:
            raise ValueError('print file is not allowed')
        text = sep.join(str(v) for v in values) + end
        stdout = (stdout + text).encode('utf-8')[:4096].decode('utf-8', errors='ignore')

    def importer(name, globals=None, locals=None, fromlist=(), level=0):
        if name not in _MODULES or level:
            raise ImportError('import not allowed: ' + name)
        return _SafeModule(name)

    safe_names = ('abs', 'all', 'any', 'bool', 'dict', 'enumerate', 'filter', 'float', 'frozenset',
                  'int', 'isinstance', 'issubclass', 'iter', 'len', 'list', 'map', 'max', 'min',
                  'next', 'range', 'repr', 'reversed', 'round', 'set', 'slice', 'sorted', 'str',
                  'sum', 'tuple', 'zip', 'chr', 'ord', 'pow', 'divmod', 'Exception', 'ValueError',
                  'RuntimeError', 'TypeError', 'KeyError', 'IndexError', 'ZeroDivisionError')
    safe = {name: getattr(_builtins, name) for name in safe_names}
    safe.update({'__build_class__': _builtins.__build_class__, '__import__': importer, 'print': output})
    namespace = {'__builtins__': safe, '__name__': '__user__'}

    def snapshot(frame, event, arg):
        heap = {}
        def value(v, depth=0):
            if v is None or isinstance(v, (bool, str)):
                return {'prim': v[:60] if isinstance(v, str) else v}
            if isinstance(v, (int, float)):
                return {'prim': v if isinstance(v, int) and abs(v) <= 9007199254740991 or isinstance(v, float) and _math.isfinite(v) else str(v)[:60]}
            ref = str(id(v))
            if ref in heap:
                return {'ref': ref}
            if len(heap) >= 200:
                return {'prim': '[heap limit]'}
            obj = {'kind': 'object', 'cls': v.__class__.__name__[:60]}
            heap[ref] = obj
            if depth >= 4:
                obj['truncated'] = True
            elif isinstance(v, (list, tuple, set, frozenset)):
                obj['kind'] = 'tuple' if isinstance(v, tuple) else 'set' if isinstance(v, (set, frozenset)) else 'list'
                obj['items'] = [value(x, depth+1) for x in list(v)[:50]]
                if len(v) > 50: obj['truncated'] = True
            elif isinstance(v, dict):
                obj['kind'] = 'dict'
                obj['entries'] = [[value(k, depth+1), value(x, depth+1)] for k, x in list(v.items())[:50]]
                if len(v) > 50: obj['truncated'] = True
            elif hasattr(v, '__dict__'):
                fields = [(k, x) for k, x in vars(v).items() if not k.startswith('_')]
                obj['fields'] = {k: value(x, depth+1) for k, x in fields[:50]}
                if len(fields) > 50: obj['truncated'] = True
            return {'ref': ref}

        frames, current = [], frame
        while current is not None:
            if current.f_code.co_filename == '<user>' and current.f_code.co_name != '<module>':
                local = {k: value(v) for k, v in list(current.f_locals.items())[:50] if not k.startswith('_') and not callable(v)}
                frames.append({'fn': current.f_code.co_name, 'locals': local})
            current = current.f_back
        step = {'i': len(steps), 'event': event, 'pyLine': frame.f_lineno, 'origLines': [],
                'frames': list(reversed(frames)), 'heap': heap, 'stdout': stdout}
        if event == 'return': step['returnValue'] = value(arg)
        if event == 'exception': step['exception'] = str(arg[0].__name__) + ': ' + str(arg[1])[:500]
        steps.append(step)

    def tracer(frame, event, arg):
        nonlocal line_events, truncated
        if frame.f_code.co_filename != '<user>': return tracer
        if event == 'line':
            line_events += 1
            if line_events > 1000:
                truncated = True
                raise _LineLimit()
        name = frame.f_code.co_name
        if name != '<module>' and (not focus or name in focus) and event in ('line', 'call', 'return', 'exception'):
            snapshot(frame, event, arg)
        return tracer

    error = None
    try:
        python_tree = _ast.parse(request['python'], '<user>', 'exec')
        entry_tree = _ast.parse(request['entry'], '<entry>', 'eval')
        _validate(python_tree); _validate(entry_tree)
        _sys.settrace(tracer)
        exec(compile(python_tree, '<user>', 'exec'), namespace)
        result = eval(compile(entry_tree, '<entry>', 'eval'), namespace)
        # Top-level entries without a function still receive a final, inspectable result.
        if not steps:
            result_json = result if result is None or isinstance(result, (str, int, float, bool)) else str(result)[:60]
            steps.append({'i': 0, 'event': 'return', 'pyLine': 0, 'origLines': [], 'frames': [], 'heap': {}, 'stdout': stdout, 'returnValue': {'prim': result_json}})
    except _LineLimit:
        truncated = True
    except BaseException as exc:
        error = ''.join(_traceback.format_exception(exc))[-8192:]
    finally:
        _sys.settrace(None)
        namespace.clear()
    result = {'steps': steps, 'truncated': truncated}
    if error: result['error'] = error
    return _json.dumps(result, allow_nan=False)
