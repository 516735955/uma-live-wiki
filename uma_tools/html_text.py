"""Split visible HTML text from unchanged markup using the standard parser."""
import html
from html.parser import HTMLParser
import json
import re
import sys


def text_parts(source):
    starts = [0]
    starts.extend(match.end() for match in re.finditer('\n', source))
    spans = []

    class Text(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=False)
            self.hidden = 0

        def handle_starttag(self, tag, attrs):
            if tag in ('script', 'style'):
                self.hidden += 1

        def handle_endtag(self, tag):
            if tag in ('script', 'style'):
                self.hidden = max(0, self.hidden - 1)

        def handle_startendtag(self, tag, attrs):
            pass

        def visible(self, length):
            if self.hidden or not length:
                return
            line, column = self.getpos()
            start = starts[line - 1] + column
            if spans and spans[-1][1] == start:
                spans[-1] = (spans[-1][0], start + length)
            else:
                spans.append((start, start + length))

        def handle_data(self, data):
            self.visible(len(data))

        def reference(self, prefix, name):
            line, column = self.getpos()
            start = starts[line - 1] + column
            size = len(prefix) + len(name)
            if source[start + size:start + size + 1] == ';':
                size += 1
            self.visible(size)

        def handle_entityref(self, name):
            self.reference('&', name)

        def handle_charref(self, name):
            self.reference('&#', name)

    parser = Text()
    parser.feed(source)
    parser.close()
    parts, cursor = [], 0
    for start, end in spans:
        if cursor < start:
            parts.append({'markup': source[cursor:start]})
        parts.append({'text': html.unescape(source[start:end]), 'source': source[start:end]})
        cursor = end
    if cursor < len(source):
        parts.append({'markup': source[cursor:]})
    return parts


if __name__ == '__main__':
    print(json.dumps(text_parts(sys.stdin.read()), ensure_ascii=False))
