import json
import argparse

def get_package_version(path, package_name):
    """Extract version from given `package.json` file."""
    with open(path) as f:
        package = json.load(f)
        if package_name == 'neurodesk':
            return package['version']
        elif package_name == 'tinyrange':
            return package['tinyrange_version']
        elif package_name == 'ndappx':
            return package['ndappx_version']
        else:
            raise ValueError(f"Unknown package: {package}")

if __name__ == '__main__':   
    parser = argparse.ArgumentParser(
        prog="Get package version from package.json",
    )
    
    parser.add_argument("--package_name", type=str, required=True, help="Package name")

    args = parser.parse_args()

    print(get_package_version(path='package.json', package_name=args.package_name))