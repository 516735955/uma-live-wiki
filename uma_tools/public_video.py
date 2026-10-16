"""Configure the installed public-video extractor without cookies or account access."""
from functools import lru_cache
import re
import subprocess


def error_reason(error):
    message = getattr(error, 'stderr', '') or str(error)
    if isinstance(message, bytes):
        message = message.decode('utf-8', 'replace')
    if isinstance(error, subprocess.TimeoutExpired) or re.search(r'timed?\s*out|timeout|connection (?:refused|reset)|network is unreachable', message, re.I):
        return 'public video network timeout or connection failure'
    if re.search(r'confirm.*not a bot|sign in.*bot', message, re.I):
        return 'public video provider requires a bot challenge'
    return re.sub(r'https?://\S+', '<public source>', message).strip()[-250:] or type(error).__name__


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
