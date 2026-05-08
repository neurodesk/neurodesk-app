#!/usr/bin/env python3
"""
Run Python code inside a remote Jupyter kernel via the kernel WebSocket protocol.

Primary use case: execute pytest /opt/tests/<file>.py inside a TinyRange VM where
no `exec` mechanism is available, but the Jupyter HTTP port is forwarded.

The script:
  1. Creates a python3 kernel via POST /api/kernels.
  2. Opens the kernel WebSocket at /api/kernels/<id>/channels.
  3. Waits for execution_state == "idle" via WebSocket iopub (not REST polling).
  4. Sends a single execute_request, streams iopub stdout/stderr to the host.
  5. Captures the SystemExit code (from pytest.main's return value) and returns it.
  6. Best-effort DELETE of the kernel on exit.
"""
import argparse
import json
import sys
import time
import uuid

import requests
import websocket  # websocket-client


def _make_msg(msg_type, content, session):
    return {
        'header': {
            'msg_id': uuid.uuid4().hex,
            'username': 'jupyter_exec',
            'session': session,
            'msg_type': msg_type,
            'version': '5.3'
        },
        'parent_header': {},
        'metadata': {},
        'content': content,
        'channel': 'shell'
    }


def run(url, token, code, timeout=1800, quiet_on_success=False):
    headers = {'Authorization': f'token {token}'}

    for attempt in range(3):
        try:
            r = requests.post(
                f'{url}/api/kernels',
                headers=headers,
                json={'name': 'python3'},
                timeout=60
            )
            r.raise_for_status()
            break
        except requests.exceptions.Timeout:
            if attempt == 2:
                raise
            print(
                f'[jupyter_exec] kernel creation timed out, retrying ({attempt + 1}/3)...',
                file=sys.stderr,
                flush=True
            )
            time.sleep(5)
    kernel_id = r.json()['id']
    print(f'[jupyter_exec] created kernel {kernel_id}', file=sys.stderr, flush=True)

    buffered_output = []

    def _write(stream, text):
        if quiet_on_success:
            buffered_output.append((stream, text))
        else:
            stream.write(text)
            stream.flush()

    try:
        ws_url = url.replace('https://', 'wss://').replace('http://', 'ws://')
        ws_url = f'{ws_url}/api/kernels/{kernel_id}/channels?token={token}'
        for attempt in range(3):
            try:
                ws = websocket.create_connection(ws_url, timeout=60)
                break
            except (websocket.WebSocketTimeoutException, websocket.WebSocketException, ConnectionError) as e:
                if attempt == 2:
                    raise
                print(
                    f'[jupyter_exec] WebSocket connection failed, retrying ({attempt + 1}/3)...',
                    file=sys.stderr,
                    flush=True
                )
                time.sleep(5)

        try:
            # Wait for kernel to reach idle state via WebSocket iopub
            deadline = time.time() + 120
            ws.settimeout(5)
            while time.time() < deadline:
                try:
                    raw = ws.recv()
                except websocket.WebSocketTimeoutException:
                    continue
                if not raw:
                    continue
                m = json.loads(raw)
                mtype = m.get('header', {}).get('msg_type')
                content = m.get('content', {})
                if (
                    mtype == 'status'
                    and content.get('execution_state') == 'idle'
                ):
                    print(
                        '[jupyter_exec] kernel is idle, sending code',
                        file=sys.stderr,
                        flush=True
                    )
                    break
            else:
                print(
                    '[jupyter_exec] kernel did not reach idle state',
                    file=sys.stderr
                )
                return 1

            session = uuid.uuid4().hex
            msg = _make_msg(
                'execute_request',
                {
                    'code': code,
                    'silent': False,
                    'store_history': False,
                    'user_expressions': {},
                    'allow_stdin': False,
                    'stop_on_error': True
                },
                session
            )
            my_msg_id = msg['header']['msg_id']
            ws.send(json.dumps(msg))

            exit_code = None
            finished = False
            deadline = time.time() + timeout
            ws.settimeout(30)
            while time.time() < deadline:
                try:
                    raw = ws.recv()
                except websocket.WebSocketTimeoutException:
                    continue
                if not raw:
                    continue
                m = json.loads(raw)
                if m.get('parent_header', {}).get('msg_id') != my_msg_id:
                    continue
                mtype = m.get('header', {}).get('msg_type')
                content = m.get('content', {})

                if mtype == 'stream':
                    out = (
                        sys.stdout
                        if content.get('name') == 'stdout'
                        else sys.stderr
                    )
                    _write(out, content.get('text', ''))
                elif mtype == 'error':
                    ename = content.get('ename', '')
                    evalue = content.get('evalue', '')
                    tb = '\n'.join(content.get('traceback', []))
                    _write(sys.stderr, f'\n{tb}\n')
                    if ename == 'SystemExit':
                        try:
                            exit_code = int(evalue)
                        except (TypeError, ValueError):
                            exit_code = 1
                    else:
                        exit_code = 1
                elif (
                    mtype == 'status'
                    and content.get('execution_state') == 'idle'
                ):
                    finished = True
                    break

            if not finished:
                print(
                    '[jupyter_exec] timed out waiting for completion',
                    file=sys.stderr
                )
                return 1

            rc = exit_code if exit_code is not None else 0

            # Flush buffered output only on failure
            if quiet_on_success and rc != 0:
                for stream, text in buffered_output:
                    stream.write(text)
                    stream.flush()

            return rc
        finally:
            try:
                ws.close()
            except Exception:
                pass
    finally:
        try:
            requests.delete(
                f'{url}/api/kernels/{kernel_id}',
                headers=headers,
                timeout=10
            )
        except Exception:
            pass


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        '--url',
        required=True,
        help='Jupyter base URL, e.g. http://127.0.0.1:8888'
    )
    ap.add_argument('--token', required=True, help='Jupyter auth token')
    grp = ap.add_mutually_exclusive_group(required=True)
    grp.add_argument(
        '--pytest',
        metavar='PATH',
        help='Run `pytest <PATH> -v` inside the kernel'
    )
    grp.add_argument(
        '--code', metavar='SRC', help='Arbitrary Python source to execute'
    )
    ap.add_argument(
        '--timeout',
        type=int,
        default=1800,
        help='Per-execution timeout in seconds'
    )
    ap.add_argument(
        '--quiet',
        action='store_true',
        help='Suppress output when execution succeeds (exit code 0)'
    )
    ap.add_argument(
        '--ignore',
        action='append',
        default=[],
        metavar='PATH',
        help='Pass --ignore=PATH to pytest (repeatable)'
    )
    ap.add_argument(
        '-k',
        dest='keyword_expr',
        default=None,
        help='Pass -k EXPRESSION to pytest for test selection'
    )
    args = ap.parse_args()

    if args.pytest:
        pytest_args = [args.pytest, '-v']
        for ign in args.ignore:
            pytest_args.append(f'--ignore={ign}')
        if args.keyword_expr:
            pytest_args.append('-k')
            pytest_args.append(args.keyword_expr)
        code = (
            'import os, subprocess, sys\n'
            'os.umask(0)\n'
            'subprocess.run(["sudo", "chown", "-R", f"{os.getuid()}:{os.getgid()}", "/home/jovyan/.cache"], check=False)\n'
            'subprocess.run(["sudo", "find", "/neurodesktop-storage", "-not", "-type", "s", "-exec", "chmod", "777", "{}", "+"], check=False)\n'
            '# Monkey-patch os.makedirs: 9p/virtfs ignores guest umask,\n'
            '# so newly created dirs may lack write permission.\n'
            '_orig_makedirs = os.makedirs\n'
            'def _fixed_makedirs(name, mode=0o777, exist_ok=False):\n'
            '    _orig_makedirs(name, mode=mode, exist_ok=exist_ok)\n'
            '    try:\n'
            '        os.chmod(name, 0o777)\n'
            '    except OSError:\n'
            '        subprocess.run(["sudo", "chmod", "777", str(name)], check=False)\n'
            'os.makedirs = _fixed_makedirs\n'
            'try:\n'
            '    import nest_asyncio; nest_asyncio.apply()\n'
            'except ImportError:\n'
            '    pass\n'
            'import pytest\n'
            f'sys.exit(pytest.main({pytest_args!r}))\n'
        )
    else:
        code = args.code

    url = args.url.rstrip('/')
    sys.exit(run(url, args.token, code, timeout=args.timeout, quiet_on_success=args.quiet))


if __name__ == '__main__':
    main()
