from urllib.request import Request, urlopen
import json
import os
import re

REPOSITORY = "neurodesktop"
ORGANIZATION = "neurodesk"

# Stable Neurodesktop releases are tagged by date; this is also the tag of the
# vnmd/neurodesktop image the app pulls.
VERSION_PATTERN = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def find_latest_stable(owner, repository):
    """Find latest stable release on GitHub for given repository."""
    endpoint = f"https://api.github.com/repos/{owner}/{repository}/releases?per_page=100"
    headers = {'Accept': 'application/vnd.github+json'}
    token = os.environ.get('GITHUB_TOKEN')
    if token:
        headers['Authorization'] = f'Bearer {token}'
    with urlopen(Request(endpoint, headers=headers)) as response:
        releases = json.load(response)
    versions = [
        release['tag_name']
        for release in releases
        if not release['draft']
        and not release['prerelease']
        and VERSION_PATTERN.match(release['tag_name'])
    ]
    if not versions:
        raise SystemExit(f'No stable release found in {owner}/{repository}')
    return max(versions)


if __name__ == '__main__':
    print(find_latest_stable(owner=ORGANIZATION, repository=REPOSITORY))
