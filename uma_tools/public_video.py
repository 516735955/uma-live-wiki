"""Configure the installed public-video extractor without cookies or account access."""
from functools import lru_cache
import subprocess


@lru_cache(maxsize=1)
def extractor_flags():
    flags = ['--force-ipv4', '--retries', '1', '--extractor-retries', '1']
    try:
        help_text = subprocess.run(['yt-dlp','--help'],capture_output=True,text=True,encoding='utf-8',timeout=10).stdout
        if '--js-runtimes' in help_text:
            flags.extend(['--js-runtimes','node'])
    except (OSError, subprocess.SubprocessError):
        pass
    return flags


def yt_command(arguments):
    return ['yt-dlp', *extractor_flags(), *arguments]
