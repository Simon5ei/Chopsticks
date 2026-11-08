"""Explicitly configured, read-only MaiBot SDK plugins over a private JSONL child."""
import asyncio
import contextlib
import contextvars
import importlib.util
import json
import logging
import sys
from pathlib import Path

PROTOCOL_OUT = sys.stdout
sys.stdout = sys.stderr  # Candidate prints must never become protocol messages.
logging.basicConfig(level=logging.CRITICAL)
MAX_LINE = 65536
CURRENT_CALL = contextvars.ContextVar('current_call', default=None)
SPECS = {
    'date': ('github.xiexiaojia780.date-context-plugin', {'query_date', 'query_holiday'}),
    'wiki': ('xxxxx7258.moegirl-wiki-plugin', {'moegirl_lookup'}),
}


class Runner:
    def __init__(self):
        self.plugins = {}
        self.tools = {}
        self.host_requests = {}
        self.request_sequence = 0

    async def host_json(self, params):
        self.request_sequence += 1
        request_id = self.request_sequence
        future = asyncio.get_running_loop().create_future()
        self.host_requests[request_id] = future
        emit({'capability': 'wiki.get', 'requestId': request_id, 'parentId': CURRENT_CALL.get(), 'params': params})
        try:
            return await asyncio.wait_for(future, timeout=20)
        finally:
            self.host_requests.pop(request_id, None)

    async def denied_rpc(self, *args, **kwargs):
        raise PermissionError('Host capability is not supported by this read-only bridge')

    async def initialize(self, message):
        from maibot_sdk.context import PluginContext, PluginPaths
        from maibot_sdk.config import merge_plugin_config_data
        from maibot_sdk.types import ToolComponentInfo
        if self.plugins:
            raise ValueError('Already initialized')
        specs = message.get('plugins')
        data = Path(message['dataDir'])
        if not data.is_absolute() or not isinstance(specs, list) or not 1 <= len(specs) <= 2:
            raise ValueError('Invalid initialization')
        definitions = []
        for spec in specs:
            kind = spec['kind']
            if kind not in SPECS or kind in self.plugins:
                raise ValueError('Unsupported or duplicate plugin')
            root = Path(spec['root']).resolve(strict=True)
            manifest = json.loads((root / '_manifest.json').read_text(encoding='utf-8-sig'))
            expected_id, allow = SPECS[kind]
            if manifest.get('id') != expected_id:
                raise ValueError('Unexpected plugin identity')
            module_name = 'chopsticks_maibot_' + kind
            module_spec = importlib.util.spec_from_file_location(module_name, root / 'plugin.py', submodule_search_locations=[str(root)])
            module = importlib.util.module_from_spec(module_spec)
            sys.modules[module_name] = module
            module_spec.loader.exec_module(module)
            if kind == 'wiki':
                # Keep the original parser/search/cache logic. All HTTP goes through
                # Chopsticks' existing DNS-pinned, size-bounded public fetcher.
                async def request_json(client, params, error_type=sys.modules[module_name + '.client'].MoegirlApiError):
                    try:
                        result = await self.host_json(params)
                    except RuntimeError:
                        raise error_type('Wiki request unavailable') from None
                    if isinstance(result, dict) and isinstance(result.get('error'), dict):
                        raise error_type('Wiki API unavailable')
                    return result
                sys.modules[module_name + '.client'].MoegirlApiClient._request_json = request_json
            plugin = module.create_plugin()
            merged, _ = merge_plugin_config_data(plugin.get_default_config(), spec.get('config', {}))
            config, _ = plugin.normalize_plugin_config(merged)
            if kind == 'date':
                config['reply_injection']['enabled'] = False
                config['planner_injection']['enabled'] = False
            plugin.set_plugin_config(config)
            home = data / kind
            home.mkdir(parents=True, exist_ok=True)
            paths = PluginPaths(data_dir=home, runtime_dir=home / 'temp')
            plugin._set_context(PluginContext(expected_id, self.denied_rpc, paths))
            self.plugins[kind] = plugin
            await plugin.on_load()
            for component in plugin.get_components():
                if component['type'] != 'TOOL' or component['name'] not in allow:
                    continue
                name = component['name']
                metadata = component['metadata']
                info = ToolComponentInfo(name=name, **{k: v for k, v in metadata.items() if k != 'handler_name'})
                self.tools[(kind, name)] = getattr(plugin, metadata['handler_name'])
                schema = info.get_parameters_schema() or {'type': 'object', 'properties': {}}
                schema['additionalProperties'] = False
                definitions.append({'name': f'mcp__maibot_{kind}__{name}', 'plugin': kind, 'rawName': name,
                                    'description': info.get_brief_description(), 'inputSchema': schema})
            if {name for group, name in self.tools if group == kind} != allow:
                raise ValueError('Plugin tools differ from the supported contract')
        return {'tools': definitions}

    async def call(self, message):
        handler = self.tools.get((message.get('plugin'), message.get('name')))
        if handler is None or not isinstance(message.get('args'), dict):
            raise ValueError('Unknown tool')
        args = message['args']
        if len(json.dumps(args, ensure_ascii=False)) > 12000:
            raise ValueError('Arguments too large')
        return await asyncio.wait_for(handler(**args), timeout=25)

    async def close(self):
        for plugin in reversed(list(self.plugins.values())):
            with contextlib.suppress(Exception):
                await asyncio.wait_for(plugin.on_unload(), timeout=2)


def emit(value):
    encoded = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    if len(encoded.encode('utf-8')) > 900000:
        encoded = json.dumps({'id': value['id'], 'error': 'response_too_large'})
    PROTOCOL_OUT.write(encoded + '\n')
    PROTOCOL_OUT.flush()


async def main():
    runner = Runner()
    tasks = {}

    async def execute(message):
        token = CURRENT_CALL.set(message['id'])
        try:
            result = await runner.call(message)
            emit({'id': message['id'], 'result': result})
        except (Exception, asyncio.CancelledError):
            emit({'id': message['id'], 'error': 'plugin_operation_failed'})
        finally:
            CURRENT_CALL.reset(token)
            tasks.pop(message['id'], None)

    try:
        while True:
            line = await asyncio.to_thread(sys.stdin.buffer.readline, MAX_LINE + 1)
            if not line:
                break
            if len(line) > MAX_LINE:
                break
            message = json.loads(line)
            if message.get('method') == 'close':
                break
            if message.get('method') == 'cancel':
                task = tasks.get(message.get('requestId'))
                if task:
                    task.cancel()
                continue
            if message.get('method') == 'host_result':
                future = runner.host_requests.get(message.get('requestId'))
                if future is not None and not future.done():
                    if message.get('error'):
                        future.set_exception(RuntimeError('Wiki request unavailable'))
                    else:
                        future.set_result(message.get('result'))
                continue
            try:
                if message.get('method') == 'init':
                    result = await runner.initialize(message)
                elif message.get('method') == 'call':
                    if len(tasks) >= 16:
                        raise ValueError('Too many active reads')
                    tasks[message['id']] = asyncio.create_task(execute(message))
                    continue
                else:
                    raise ValueError('Unknown method')
                emit({'id': message['id'], 'result': result})
            except Exception:
                emit({'id': message.get('id'), 'error': 'plugin_operation_failed'})
    finally:
        for task in list(tasks.values()):
            task.cancel()
        await asyncio.gather(*list(tasks.values()), return_exceptions=True)
        await runner.close()


if __name__ == '__main__':
    asyncio.run(main())
