"""Bound table payloads before decoding untrusted JSON."""

import json

from rest_framework.exceptions import ParseError
from rest_framework.parsers import JSONParser


class TableJSONParser(JSONParser):
    def parse(self, stream, media_type=None, parser_context=None):
        body = stream.read(1_048_577)
        if len(body) > 1_048_576:
            raise ParseError("Table requests are limited to 1 MiB.")
        try:
            value = json.loads(body, parse_constant=self.invalid_number)
            pending = [(value, 0)]
            while pending:
                current, depth = pending.pop()
                if depth > 8:
                    raise ValueError("Table JSON nesting exceeds 8 levels.")
                if isinstance(current, dict):
                    pending.extend((child, depth + 1) for child in current.values())
                elif isinstance(current, list):
                    pending.extend((child, depth + 1) for child in current)
            return value
        except (ValueError, UnicodeError, RecursionError) as error:
            raise ParseError("Enter a valid JSON table request.") from error

    @staticmethod
    def invalid_number(value):
        raise ValueError("Nonfinite numbers are not supported.")
