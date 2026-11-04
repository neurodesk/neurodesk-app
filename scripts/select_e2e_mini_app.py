"""Select a mini app in the running Electron welcome page through DevTools."""

import argparse
import json
import re
import time
from urllib.request import urlopen

import websocket


def click_local_button(websocket_url: str, app_id: str) -> bool:
    expression = f"""(() => {{
      const card = document.getElementById({json.dumps(app_id)});
      const button = card && card.querySelector('.split-btn-main, .local-btn');
      if (!button || button.disabled || !window.electronAPI?.newSession) return false;
      button.click();
      return true;
    }})()"""

    connection = websocket.create_connection(
        websocket_url, timeout=5, suppress_origin=True
    )
    try:
        connection.send(
            json.dumps(
                {
                    "id": 1,
                    "method": "Runtime.evaluate",
                    "params": {
                        "expression": expression,
                        "returnByValue": True,
                        "userGesture": True,
                    },
                }
            )
        )
        while True:
            response = json.loads(connection.recv())
            if response.get("id") != 1:
                continue
            if "error" in response or "exceptionDetails" in response.get("result", {}):
                raise RuntimeError(f"DevTools evaluation failed: {response}")
            return response.get("result", {}).get("result", {}).get("value") is True
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app_id", help="ID of the mini app card, e.g. neurodesk")
    parser.add_argument("--port", type=int, default=9222)
    parser.add_argument("--timeout", type=int, default=90)
    args = parser.parse_args()

    if not re.fullmatch(r"[a-z0-9-]+", args.app_id):
        parser.error("app_id must contain only lowercase letters, digits, or dashes")

    deadline = time.monotonic() + args.timeout
    targets = []
    last_error = None
    while time.monotonic() < deadline:
        try:
            url = f"http://127.0.0.1:{args.port}/json/list"
            with urlopen(url, timeout=3) as response:
                targets = json.load(response)
            for target in targets:
                if not target.get("webSocketDebuggerUrl"):
                    continue
                try:
                    if click_local_button(target["webSocketDebuggerUrl"], args.app_id):
                        print(f"Selected mini app {args.app_id} for local launch")
                        return
                except (
                    OSError,
                    ValueError,
                    websocket.WebSocketException,
                    RuntimeError,
                ) as error:
                    last_error = error
        except (OSError, ValueError) as error:
            last_error = error
        time.sleep(1)

    visible_targets = [(target.get("type"), target.get("title")) for target in targets]
    raise SystemExit(
        f"Could not select mini app {args.app_id} within {args.timeout}s. "
        f"DevTools targets: {visible_targets}. Last error: {last_error}"
    )


if __name__ == "__main__":
    main()
