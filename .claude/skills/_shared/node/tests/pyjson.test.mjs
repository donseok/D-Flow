import test from 'node:test';
import assert from 'node:assert/strict';
import { pyJsonDumps, pyFloat, pyFloatRepr, PyFloat } from '../pyjson.mjs';
import { findPython, runCommand } from '../proc.mjs';

// <<GEN:START>> (scratch generator 가 이 PC 의 python3 로 만든 기대값. 손으로 고치지 말 것)
const DATA = {
 "cases": [
  {
   "name": "empty",
   "text": "{\"a\": [], \"b\": {}, \"c\": [[], {}], \"d\": \"\"}"
  },
  {
   "name": "nested",
   "text": "{\"z\": {\"y\": [1, 2, {\"x\": null}], \"a\": true}, \"b\": false, \"a\": [1, [2, [3, []]]]}"
  },
  {
   "name": "korean",
   "text": "{\"\uc774\ub984\": \"\ud64d\uae38\ub3d9\", \"\uc124\uba85\": \"\ud55c\uae00 \\\"\ub530\uc634\ud45c\\\" \uc640 \\\\ \uc5ed\uc2ac\ub798\uc2dc\", \"\ubaa9\ub85d\": [\"\uac00\", \"\ub098\", \"\ub2e4\"]}"
  },
  {
   "name": "emoji",
   "text": "{\"e\": \"\ud83d\ude00 pile \ud83d\udca9 flag \ud83c\uddf0\ud83c\uddf7\", \"mixed\": \"a\ud83d\ude00b\", \"\ud83d\ude00\": 1}"
  },
  {
   "name": "special",
   "text": "{\"s\": \"tab\\t nl\\n cr\\r bs\\b ff\\f nul\\u0000 us\\u001f del\\u007f slash/ quote\\\" bs\\\\ ls\\u2028 ps\\u2029 e\\u00e9 \\ud800 lone\"}"
  },
  {
   "name": "scalars",
   "text": "[0, -1, 1, 9007199254740991, true, false, null, \"s\", -9007199254740991]"
  },
  {
   "name": "floats",
   "text": "[0.1, 1.5, -2.25, 1.5e-07, 0.0001, 0.00001, 123456789.123456789, 5e-324, 3.141592653589793, 0.30000000000000004, 1e-10]"
  },
  {
   "name": "sortkeys",
   "text": "{\"b\": 1, \"B\": 2, \"a\": {\"d\": 1, \"c\": 2, \"C\": 0}, \"\uac00\": 3, \"z\": 4, \"\u00e9\": 5, \"\\ue000\": 6, \"\ud83d\ude00\": 7, \"_\": 8, \"A b\": 9}"
  },
  {
   "name": "listdicts",
   "text": "[{\"id\": 1, \"tags\": [\"a\", \"b\"]}, {\"id\": 2, \"tags\": []}, {}]"
  },
  {
   "name": "top_str",
   "text": "\"\ud55c\uae00 \\u0001 \\\"x\\\"\""
  },
  {
   "name": "top_num",
   "text": "42"
  },
  {
   "name": "top_null",
   "text": "null"
  },
  {
   "name": "top_emptylist",
   "text": "[]"
  },
  {
   "name": "top_emptydict",
   "text": "{}"
  }
 ],
 "opts": [
  {
   "indent": null,
   "ea": true,
   "sk": false
  },
  {
   "indent": null,
   "ea": true,
   "sk": true
  },
  {
   "indent": null,
   "ea": false,
   "sk": false
  },
  {
   "indent": null,
   "ea": false,
   "sk": true
  },
  {
   "indent": 0,
   "ea": true,
   "sk": false
  },
  {
   "indent": 0,
   "ea": true,
   "sk": true
  },
  {
   "indent": 0,
   "ea": false,
   "sk": false
  },
  {
   "indent": 0,
   "ea": false,
   "sk": true
  },
  {
   "indent": 1,
   "ea": true,
   "sk": false
  },
  {
   "indent": 1,
   "ea": true,
   "sk": true
  },
  {
   "indent": 1,
   "ea": false,
   "sk": false
  },
  {
   "indent": 1,
   "ea": false,
   "sk": true
  },
  {
   "indent": 2,
   "ea": true,
   "sk": false
  },
  {
   "indent": 2,
   "ea": true,
   "sk": true
  },
  {
   "indent": 2,
   "ea": false,
   "sk": false
  },
  {
   "indent": 2,
   "ea": false,
   "sk": true
  }
 ],
 "expected": {
  "empty": [
   "{\"a\": [], \"b\": {}, \"c\": [[], {}], \"d\": \"\"}",
   "{\"a\": [], \"b\": {}, \"c\": [[], {}], \"d\": \"\"}",
   "{\"a\": [], \"b\": {}, \"c\": [[], {}], \"d\": \"\"}",
   "{\"a\": [], \"b\": {}, \"c\": [[], {}], \"d\": \"\"}",
   "{\n\"a\": [],\n\"b\": {},\n\"c\": [\n[],\n{}\n],\n\"d\": \"\"\n}",
   "{\n\"a\": [],\n\"b\": {},\n\"c\": [\n[],\n{}\n],\n\"d\": \"\"\n}",
   "{\n\"a\": [],\n\"b\": {},\n\"c\": [\n[],\n{}\n],\n\"d\": \"\"\n}",
   "{\n\"a\": [],\n\"b\": {},\n\"c\": [\n[],\n{}\n],\n\"d\": \"\"\n}",
   "{\n \"a\": [],\n \"b\": {},\n \"c\": [\n  [],\n  {}\n ],\n \"d\": \"\"\n}",
   "{\n \"a\": [],\n \"b\": {},\n \"c\": [\n  [],\n  {}\n ],\n \"d\": \"\"\n}",
   "{\n \"a\": [],\n \"b\": {},\n \"c\": [\n  [],\n  {}\n ],\n \"d\": \"\"\n}",
   "{\n \"a\": [],\n \"b\": {},\n \"c\": [\n  [],\n  {}\n ],\n \"d\": \"\"\n}",
   "{\n  \"a\": [],\n  \"b\": {},\n  \"c\": [\n    [],\n    {}\n  ],\n  \"d\": \"\"\n}",
   "{\n  \"a\": [],\n  \"b\": {},\n  \"c\": [\n    [],\n    {}\n  ],\n  \"d\": \"\"\n}",
   "{\n  \"a\": [],\n  \"b\": {},\n  \"c\": [\n    [],\n    {}\n  ],\n  \"d\": \"\"\n}",
   "{\n  \"a\": [],\n  \"b\": {},\n  \"c\": [\n    [],\n    {}\n  ],\n  \"d\": \"\"\n}"
  ],
  "nested": [
   "{\"z\": {\"y\": [1, 2, {\"x\": null}], \"a\": true}, \"b\": false, \"a\": [1, [2, [3, []]]]}",
   "{\"a\": [1, [2, [3, []]]], \"b\": false, \"z\": {\"a\": true, \"y\": [1, 2, {\"x\": null}]}}",
   "{\"z\": {\"y\": [1, 2, {\"x\": null}], \"a\": true}, \"b\": false, \"a\": [1, [2, [3, []]]]}",
   "{\"a\": [1, [2, [3, []]]], \"b\": false, \"z\": {\"a\": true, \"y\": [1, 2, {\"x\": null}]}}",
   "{\n\"z\": {\n\"y\": [\n1,\n2,\n{\n\"x\": null\n}\n],\n\"a\": true\n},\n\"b\": false,\n\"a\": [\n1,\n[\n2,\n[\n3,\n[]\n]\n]\n]\n}",
   "{\n\"a\": [\n1,\n[\n2,\n[\n3,\n[]\n]\n]\n],\n\"b\": false,\n\"z\": {\n\"a\": true,\n\"y\": [\n1,\n2,\n{\n\"x\": null\n}\n]\n}\n}",
   "{\n\"z\": {\n\"y\": [\n1,\n2,\n{\n\"x\": null\n}\n],\n\"a\": true\n},\n\"b\": false,\n\"a\": [\n1,\n[\n2,\n[\n3,\n[]\n]\n]\n]\n}",
   "{\n\"a\": [\n1,\n[\n2,\n[\n3,\n[]\n]\n]\n],\n\"b\": false,\n\"z\": {\n\"a\": true,\n\"y\": [\n1,\n2,\n{\n\"x\": null\n}\n]\n}\n}",
   "{\n \"z\": {\n  \"y\": [\n   1,\n   2,\n   {\n    \"x\": null\n   }\n  ],\n  \"a\": true\n },\n \"b\": false,\n \"a\": [\n  1,\n  [\n   2,\n   [\n    3,\n    []\n   ]\n  ]\n ]\n}",
   "{\n \"a\": [\n  1,\n  [\n   2,\n   [\n    3,\n    []\n   ]\n  ]\n ],\n \"b\": false,\n \"z\": {\n  \"a\": true,\n  \"y\": [\n   1,\n   2,\n   {\n    \"x\": null\n   }\n  ]\n }\n}",
   "{\n \"z\": {\n  \"y\": [\n   1,\n   2,\n   {\n    \"x\": null\n   }\n  ],\n  \"a\": true\n },\n \"b\": false,\n \"a\": [\n  1,\n  [\n   2,\n   [\n    3,\n    []\n   ]\n  ]\n ]\n}",
   "{\n \"a\": [\n  1,\n  [\n   2,\n   [\n    3,\n    []\n   ]\n  ]\n ],\n \"b\": false,\n \"z\": {\n  \"a\": true,\n  \"y\": [\n   1,\n   2,\n   {\n    \"x\": null\n   }\n  ]\n }\n}",
   "{\n  \"z\": {\n    \"y\": [\n      1,\n      2,\n      {\n        \"x\": null\n      }\n    ],\n    \"a\": true\n  },\n  \"b\": false,\n  \"a\": [\n    1,\n    [\n      2,\n      [\n        3,\n        []\n      ]\n    ]\n  ]\n}",
   "{\n  \"a\": [\n    1,\n    [\n      2,\n      [\n        3,\n        []\n      ]\n    ]\n  ],\n  \"b\": false,\n  \"z\": {\n    \"a\": true,\n    \"y\": [\n      1,\n      2,\n      {\n        \"x\": null\n      }\n    ]\n  }\n}",
   "{\n  \"z\": {\n    \"y\": [\n      1,\n      2,\n      {\n        \"x\": null\n      }\n    ],\n    \"a\": true\n  },\n  \"b\": false,\n  \"a\": [\n    1,\n    [\n      2,\n      [\n        3,\n        []\n      ]\n    ]\n  ]\n}",
   "{\n  \"a\": [\n    1,\n    [\n      2,\n      [\n        3,\n        []\n      ]\n    ]\n  ],\n  \"b\": false,\n  \"z\": {\n    \"a\": true,\n    \"y\": [\n      1,\n      2,\n      {\n        \"x\": null\n      }\n    ]\n  }\n}"
  ],
  "korean": [
   "{\"\\uc774\\ub984\": \"\\ud64d\\uae38\\ub3d9\", \"\\uc124\\uba85\": \"\\ud55c\\uae00 \\\"\\ub530\\uc634\\ud45c\\\" \\uc640 \\\\ \\uc5ed\\uc2ac\\ub798\\uc2dc\", \"\\ubaa9\\ub85d\": [\"\\uac00\", \"\\ub098\", \"\\ub2e4\"]}",
   "{\"\\ubaa9\\ub85d\": [\"\\uac00\", \"\\ub098\", \"\\ub2e4\"], \"\\uc124\\uba85\": \"\\ud55c\\uae00 \\\"\\ub530\\uc634\\ud45c\\\" \\uc640 \\\\ \\uc5ed\\uc2ac\\ub798\\uc2dc\", \"\\uc774\\ub984\": \"\\ud64d\\uae38\\ub3d9\"}",
   "{\"\uc774\ub984\": \"\ud64d\uae38\ub3d9\", \"\uc124\uba85\": \"\ud55c\uae00 \\\"\ub530\uc634\ud45c\\\" \uc640 \\\\ \uc5ed\uc2ac\ub798\uc2dc\", \"\ubaa9\ub85d\": [\"\uac00\", \"\ub098\", \"\ub2e4\"]}",
   "{\"\ubaa9\ub85d\": [\"\uac00\", \"\ub098\", \"\ub2e4\"], \"\uc124\uba85\": \"\ud55c\uae00 \\\"\ub530\uc634\ud45c\\\" \uc640 \\\\ \uc5ed\uc2ac\ub798\uc2dc\", \"\uc774\ub984\": \"\ud64d\uae38\ub3d9\"}",
   "{\n\"\\uc774\\ub984\": \"\\ud64d\\uae38\\ub3d9\",\n\"\\uc124\\uba85\": \"\\ud55c\\uae00 \\\"\\ub530\\uc634\\ud45c\\\" \\uc640 \\\\ \\uc5ed\\uc2ac\\ub798\\uc2dc\",\n\"\\ubaa9\\ub85d\": [\n\"\\uac00\",\n\"\\ub098\",\n\"\\ub2e4\"\n]\n}",
   "{\n\"\\ubaa9\\ub85d\": [\n\"\\uac00\",\n\"\\ub098\",\n\"\\ub2e4\"\n],\n\"\\uc124\\uba85\": \"\\ud55c\\uae00 \\\"\\ub530\\uc634\\ud45c\\\" \\uc640 \\\\ \\uc5ed\\uc2ac\\ub798\\uc2dc\",\n\"\\uc774\\ub984\": \"\\ud64d\\uae38\\ub3d9\"\n}",
   "{\n\"\uc774\ub984\": \"\ud64d\uae38\ub3d9\",\n\"\uc124\uba85\": \"\ud55c\uae00 \\\"\ub530\uc634\ud45c\\\" \uc640 \\\\ \uc5ed\uc2ac\ub798\uc2dc\",\n\"\ubaa9\ub85d\": [\n\"\uac00\",\n\"\ub098\",\n\"\ub2e4\"\n]\n}",
   "{\n\"\ubaa9\ub85d\": [\n\"\uac00\",\n\"\ub098\",\n\"\ub2e4\"\n],\n\"\uc124\uba85\": \"\ud55c\uae00 \\\"\ub530\uc634\ud45c\\\" \uc640 \\\\ \uc5ed\uc2ac\ub798\uc2dc\",\n\"\uc774\ub984\": \"\ud64d\uae38\ub3d9\"\n}",
   "{\n \"\\uc774\\ub984\": \"\\ud64d\\uae38\\ub3d9\",\n \"\\uc124\\uba85\": \"\\ud55c\\uae00 \\\"\\ub530\\uc634\\ud45c\\\" \\uc640 \\\\ \\uc5ed\\uc2ac\\ub798\\uc2dc\",\n \"\\ubaa9\\ub85d\": [\n  \"\\uac00\",\n  \"\\ub098\",\n  \"\\ub2e4\"\n ]\n}",
   "{\n \"\\ubaa9\\ub85d\": [\n  \"\\uac00\",\n  \"\\ub098\",\n  \"\\ub2e4\"\n ],\n \"\\uc124\\uba85\": \"\\ud55c\\uae00 \\\"\\ub530\\uc634\\ud45c\\\" \\uc640 \\\\ \\uc5ed\\uc2ac\\ub798\\uc2dc\",\n \"\\uc774\\ub984\": \"\\ud64d\\uae38\\ub3d9\"\n}",
   "{\n \"\uc774\ub984\": \"\ud64d\uae38\ub3d9\",\n \"\uc124\uba85\": \"\ud55c\uae00 \\\"\ub530\uc634\ud45c\\\" \uc640 \\\\ \uc5ed\uc2ac\ub798\uc2dc\",\n \"\ubaa9\ub85d\": [\n  \"\uac00\",\n  \"\ub098\",\n  \"\ub2e4\"\n ]\n}",
   "{\n \"\ubaa9\ub85d\": [\n  \"\uac00\",\n  \"\ub098\",\n  \"\ub2e4\"\n ],\n \"\uc124\uba85\": \"\ud55c\uae00 \\\"\ub530\uc634\ud45c\\\" \uc640 \\\\ \uc5ed\uc2ac\ub798\uc2dc\",\n \"\uc774\ub984\": \"\ud64d\uae38\ub3d9\"\n}",
   "{\n  \"\\uc774\\ub984\": \"\\ud64d\\uae38\\ub3d9\",\n  \"\\uc124\\uba85\": \"\\ud55c\\uae00 \\\"\\ub530\\uc634\\ud45c\\\" \\uc640 \\\\ \\uc5ed\\uc2ac\\ub798\\uc2dc\",\n  \"\\ubaa9\\ub85d\": [\n    \"\\uac00\",\n    \"\\ub098\",\n    \"\\ub2e4\"\n  ]\n}",
   "{\n  \"\\ubaa9\\ub85d\": [\n    \"\\uac00\",\n    \"\\ub098\",\n    \"\\ub2e4\"\n  ],\n  \"\\uc124\\uba85\": \"\\ud55c\\uae00 \\\"\\ub530\\uc634\\ud45c\\\" \\uc640 \\\\ \\uc5ed\\uc2ac\\ub798\\uc2dc\",\n  \"\\uc774\\ub984\": \"\\ud64d\\uae38\\ub3d9\"\n}",
   "{\n  \"\uc774\ub984\": \"\ud64d\uae38\ub3d9\",\n  \"\uc124\uba85\": \"\ud55c\uae00 \\\"\ub530\uc634\ud45c\\\" \uc640 \\\\ \uc5ed\uc2ac\ub798\uc2dc\",\n  \"\ubaa9\ub85d\": [\n    \"\uac00\",\n    \"\ub098\",\n    \"\ub2e4\"\n  ]\n}",
   "{\n  \"\ubaa9\ub85d\": [\n    \"\uac00\",\n    \"\ub098\",\n    \"\ub2e4\"\n  ],\n  \"\uc124\uba85\": \"\ud55c\uae00 \\\"\ub530\uc634\ud45c\\\" \uc640 \\\\ \uc5ed\uc2ac\ub798\uc2dc\",\n  \"\uc774\ub984\": \"\ud64d\uae38\ub3d9\"\n}"
  ],
  "emoji": [
   "{\"e\": \"\\ud83d\\ude00 pile \\ud83d\\udca9 flag \\ud83c\\uddf0\\ud83c\\uddf7\", \"mixed\": \"a\\ud83d\\ude00b\", \"\\ud83d\\ude00\": 1}",
   "{\"e\": \"\\ud83d\\ude00 pile \\ud83d\\udca9 flag \\ud83c\\uddf0\\ud83c\\uddf7\", \"mixed\": \"a\\ud83d\\ude00b\", \"\\ud83d\\ude00\": 1}",
   "{\"e\": \"\ud83d\ude00 pile \ud83d\udca9 flag \ud83c\uddf0\ud83c\uddf7\", \"mixed\": \"a\ud83d\ude00b\", \"\ud83d\ude00\": 1}",
   "{\"e\": \"\ud83d\ude00 pile \ud83d\udca9 flag \ud83c\uddf0\ud83c\uddf7\", \"mixed\": \"a\ud83d\ude00b\", \"\ud83d\ude00\": 1}",
   "{\n\"e\": \"\\ud83d\\ude00 pile \\ud83d\\udca9 flag \\ud83c\\uddf0\\ud83c\\uddf7\",\n\"mixed\": \"a\\ud83d\\ude00b\",\n\"\\ud83d\\ude00\": 1\n}",
   "{\n\"e\": \"\\ud83d\\ude00 pile \\ud83d\\udca9 flag \\ud83c\\uddf0\\ud83c\\uddf7\",\n\"mixed\": \"a\\ud83d\\ude00b\",\n\"\\ud83d\\ude00\": 1\n}",
   "{\n\"e\": \"\ud83d\ude00 pile \ud83d\udca9 flag \ud83c\uddf0\ud83c\uddf7\",\n\"mixed\": \"a\ud83d\ude00b\",\n\"\ud83d\ude00\": 1\n}",
   "{\n\"e\": \"\ud83d\ude00 pile \ud83d\udca9 flag \ud83c\uddf0\ud83c\uddf7\",\n\"mixed\": \"a\ud83d\ude00b\",\n\"\ud83d\ude00\": 1\n}",
   "{\n \"e\": \"\\ud83d\\ude00 pile \\ud83d\\udca9 flag \\ud83c\\uddf0\\ud83c\\uddf7\",\n \"mixed\": \"a\\ud83d\\ude00b\",\n \"\\ud83d\\ude00\": 1\n}",
   "{\n \"e\": \"\\ud83d\\ude00 pile \\ud83d\\udca9 flag \\ud83c\\uddf0\\ud83c\\uddf7\",\n \"mixed\": \"a\\ud83d\\ude00b\",\n \"\\ud83d\\ude00\": 1\n}",
   "{\n \"e\": \"\ud83d\ude00 pile \ud83d\udca9 flag \ud83c\uddf0\ud83c\uddf7\",\n \"mixed\": \"a\ud83d\ude00b\",\n \"\ud83d\ude00\": 1\n}",
   "{\n \"e\": \"\ud83d\ude00 pile \ud83d\udca9 flag \ud83c\uddf0\ud83c\uddf7\",\n \"mixed\": \"a\ud83d\ude00b\",\n \"\ud83d\ude00\": 1\n}",
   "{\n  \"e\": \"\\ud83d\\ude00 pile \\ud83d\\udca9 flag \\ud83c\\uddf0\\ud83c\\uddf7\",\n  \"mixed\": \"a\\ud83d\\ude00b\",\n  \"\\ud83d\\ude00\": 1\n}",
   "{\n  \"e\": \"\\ud83d\\ude00 pile \\ud83d\\udca9 flag \\ud83c\\uddf0\\ud83c\\uddf7\",\n  \"mixed\": \"a\\ud83d\\ude00b\",\n  \"\\ud83d\\ude00\": 1\n}",
   "{\n  \"e\": \"\ud83d\ude00 pile \ud83d\udca9 flag \ud83c\uddf0\ud83c\uddf7\",\n  \"mixed\": \"a\ud83d\ude00b\",\n  \"\ud83d\ude00\": 1\n}",
   "{\n  \"e\": \"\ud83d\ude00 pile \ud83d\udca9 flag \ud83c\uddf0\ud83c\uddf7\",\n  \"mixed\": \"a\ud83d\ude00b\",\n  \"\ud83d\ude00\": 1\n}"
  ],
  "special": [
   "{\"s\": \"tab\\t nl\\n cr\\r bs\\b ff\\f nul\\u0000 us\\u001f del\\u007f slash/ quote\\\" bs\\\\ ls\\u2028 ps\\u2029 e\\u00e9 \\ud800 lone\"}",
   "{\"s\": \"tab\\t nl\\n cr\\r bs\\b ff\\f nul\\u0000 us\\u001f del\\u007f slash/ quote\\\" bs\\\\ ls\\u2028 ps\\u2029 e\\u00e9 \\ud800 lone\"}",
   "{\"s\": \"tab\\t nl\\n cr\\r bs\\b ff\\f nul\\u0000 us\\u001f del\u007f slash/ quote\\\" bs\\\\ ls\u2028 ps\u2029 e\u00e9 \ud800 lone\"}",
   "{\"s\": \"tab\\t nl\\n cr\\r bs\\b ff\\f nul\\u0000 us\\u001f del\u007f slash/ quote\\\" bs\\\\ ls\u2028 ps\u2029 e\u00e9 \ud800 lone\"}",
   "{\n\"s\": \"tab\\t nl\\n cr\\r bs\\b ff\\f nul\\u0000 us\\u001f del\\u007f slash/ quote\\\" bs\\\\ ls\\u2028 ps\\u2029 e\\u00e9 \\ud800 lone\"\n}",
   "{\n\"s\": \"tab\\t nl\\n cr\\r bs\\b ff\\f nul\\u0000 us\\u001f del\\u007f slash/ quote\\\" bs\\\\ ls\\u2028 ps\\u2029 e\\u00e9 \\ud800 lone\"\n}",
   "{\n\"s\": \"tab\\t nl\\n cr\\r bs\\b ff\\f nul\\u0000 us\\u001f del\u007f slash/ quote\\\" bs\\\\ ls\u2028 ps\u2029 e\u00e9 \ud800 lone\"\n}",
   "{\n\"s\": \"tab\\t nl\\n cr\\r bs\\b ff\\f nul\\u0000 us\\u001f del\u007f slash/ quote\\\" bs\\\\ ls\u2028 ps\u2029 e\u00e9 \ud800 lone\"\n}",
   "{\n \"s\": \"tab\\t nl\\n cr\\r bs\\b ff\\f nul\\u0000 us\\u001f del\\u007f slash/ quote\\\" bs\\\\ ls\\u2028 ps\\u2029 e\\u00e9 \\ud800 lone\"\n}",
   "{\n \"s\": \"tab\\t nl\\n cr\\r bs\\b ff\\f nul\\u0000 us\\u001f del\\u007f slash/ quote\\\" bs\\\\ ls\\u2028 ps\\u2029 e\\u00e9 \\ud800 lone\"\n}",
   "{\n \"s\": \"tab\\t nl\\n cr\\r bs\\b ff\\f nul\\u0000 us\\u001f del\u007f slash/ quote\\\" bs\\\\ ls\u2028 ps\u2029 e\u00e9 \ud800 lone\"\n}",
   "{\n \"s\": \"tab\\t nl\\n cr\\r bs\\b ff\\f nul\\u0000 us\\u001f del\u007f slash/ quote\\\" bs\\\\ ls\u2028 ps\u2029 e\u00e9 \ud800 lone\"\n}",
   "{\n  \"s\": \"tab\\t nl\\n cr\\r bs\\b ff\\f nul\\u0000 us\\u001f del\\u007f slash/ quote\\\" bs\\\\ ls\\u2028 ps\\u2029 e\\u00e9 \\ud800 lone\"\n}",
   "{\n  \"s\": \"tab\\t nl\\n cr\\r bs\\b ff\\f nul\\u0000 us\\u001f del\\u007f slash/ quote\\\" bs\\\\ ls\\u2028 ps\\u2029 e\\u00e9 \\ud800 lone\"\n}",
   "{\n  \"s\": \"tab\\t nl\\n cr\\r bs\\b ff\\f nul\\u0000 us\\u001f del\u007f slash/ quote\\\" bs\\\\ ls\u2028 ps\u2029 e\u00e9 \ud800 lone\"\n}",
   "{\n  \"s\": \"tab\\t nl\\n cr\\r bs\\b ff\\f nul\\u0000 us\\u001f del\u007f slash/ quote\\\" bs\\\\ ls\u2028 ps\u2029 e\u00e9 \ud800 lone\"\n}"
  ],
  "scalars": [
   "[0, -1, 1, 9007199254740991, true, false, null, \"s\", -9007199254740991]",
   "[0, -1, 1, 9007199254740991, true, false, null, \"s\", -9007199254740991]",
   "[0, -1, 1, 9007199254740991, true, false, null, \"s\", -9007199254740991]",
   "[0, -1, 1, 9007199254740991, true, false, null, \"s\", -9007199254740991]",
   "[\n0,\n-1,\n1,\n9007199254740991,\ntrue,\nfalse,\nnull,\n\"s\",\n-9007199254740991\n]",
   "[\n0,\n-1,\n1,\n9007199254740991,\ntrue,\nfalse,\nnull,\n\"s\",\n-9007199254740991\n]",
   "[\n0,\n-1,\n1,\n9007199254740991,\ntrue,\nfalse,\nnull,\n\"s\",\n-9007199254740991\n]",
   "[\n0,\n-1,\n1,\n9007199254740991,\ntrue,\nfalse,\nnull,\n\"s\",\n-9007199254740991\n]",
   "[\n 0,\n -1,\n 1,\n 9007199254740991,\n true,\n false,\n null,\n \"s\",\n -9007199254740991\n]",
   "[\n 0,\n -1,\n 1,\n 9007199254740991,\n true,\n false,\n null,\n \"s\",\n -9007199254740991\n]",
   "[\n 0,\n -1,\n 1,\n 9007199254740991,\n true,\n false,\n null,\n \"s\",\n -9007199254740991\n]",
   "[\n 0,\n -1,\n 1,\n 9007199254740991,\n true,\n false,\n null,\n \"s\",\n -9007199254740991\n]",
   "[\n  0,\n  -1,\n  1,\n  9007199254740991,\n  true,\n  false,\n  null,\n  \"s\",\n  -9007199254740991\n]",
   "[\n  0,\n  -1,\n  1,\n  9007199254740991,\n  true,\n  false,\n  null,\n  \"s\",\n  -9007199254740991\n]",
   "[\n  0,\n  -1,\n  1,\n  9007199254740991,\n  true,\n  false,\n  null,\n  \"s\",\n  -9007199254740991\n]",
   "[\n  0,\n  -1,\n  1,\n  9007199254740991,\n  true,\n  false,\n  null,\n  \"s\",\n  -9007199254740991\n]"
  ],
  "floats": [
   "[0.1, 1.5, -2.25, 1.5e-07, 0.0001, 1e-05, 123456789.12345679, 5e-324, 3.141592653589793, 0.30000000000000004, 1e-10]",
   "[0.1, 1.5, -2.25, 1.5e-07, 0.0001, 1e-05, 123456789.12345679, 5e-324, 3.141592653589793, 0.30000000000000004, 1e-10]",
   "[0.1, 1.5, -2.25, 1.5e-07, 0.0001, 1e-05, 123456789.12345679, 5e-324, 3.141592653589793, 0.30000000000000004, 1e-10]",
   "[0.1, 1.5, -2.25, 1.5e-07, 0.0001, 1e-05, 123456789.12345679, 5e-324, 3.141592653589793, 0.30000000000000004, 1e-10]",
   "[\n0.1,\n1.5,\n-2.25,\n1.5e-07,\n0.0001,\n1e-05,\n123456789.12345679,\n5e-324,\n3.141592653589793,\n0.30000000000000004,\n1e-10\n]",
   "[\n0.1,\n1.5,\n-2.25,\n1.5e-07,\n0.0001,\n1e-05,\n123456789.12345679,\n5e-324,\n3.141592653589793,\n0.30000000000000004,\n1e-10\n]",
   "[\n0.1,\n1.5,\n-2.25,\n1.5e-07,\n0.0001,\n1e-05,\n123456789.12345679,\n5e-324,\n3.141592653589793,\n0.30000000000000004,\n1e-10\n]",
   "[\n0.1,\n1.5,\n-2.25,\n1.5e-07,\n0.0001,\n1e-05,\n123456789.12345679,\n5e-324,\n3.141592653589793,\n0.30000000000000004,\n1e-10\n]",
   "[\n 0.1,\n 1.5,\n -2.25,\n 1.5e-07,\n 0.0001,\n 1e-05,\n 123456789.12345679,\n 5e-324,\n 3.141592653589793,\n 0.30000000000000004,\n 1e-10\n]",
   "[\n 0.1,\n 1.5,\n -2.25,\n 1.5e-07,\n 0.0001,\n 1e-05,\n 123456789.12345679,\n 5e-324,\n 3.141592653589793,\n 0.30000000000000004,\n 1e-10\n]",
   "[\n 0.1,\n 1.5,\n -2.25,\n 1.5e-07,\n 0.0001,\n 1e-05,\n 123456789.12345679,\n 5e-324,\n 3.141592653589793,\n 0.30000000000000004,\n 1e-10\n]",
   "[\n 0.1,\n 1.5,\n -2.25,\n 1.5e-07,\n 0.0001,\n 1e-05,\n 123456789.12345679,\n 5e-324,\n 3.141592653589793,\n 0.30000000000000004,\n 1e-10\n]",
   "[\n  0.1,\n  1.5,\n  -2.25,\n  1.5e-07,\n  0.0001,\n  1e-05,\n  123456789.12345679,\n  5e-324,\n  3.141592653589793,\n  0.30000000000000004,\n  1e-10\n]",
   "[\n  0.1,\n  1.5,\n  -2.25,\n  1.5e-07,\n  0.0001,\n  1e-05,\n  123456789.12345679,\n  5e-324,\n  3.141592653589793,\n  0.30000000000000004,\n  1e-10\n]",
   "[\n  0.1,\n  1.5,\n  -2.25,\n  1.5e-07,\n  0.0001,\n  1e-05,\n  123456789.12345679,\n  5e-324,\n  3.141592653589793,\n  0.30000000000000004,\n  1e-10\n]",
   "[\n  0.1,\n  1.5,\n  -2.25,\n  1.5e-07,\n  0.0001,\n  1e-05,\n  123456789.12345679,\n  5e-324,\n  3.141592653589793,\n  0.30000000000000004,\n  1e-10\n]"
  ],
  "sortkeys": [
   "{\"b\": 1, \"B\": 2, \"a\": {\"d\": 1, \"c\": 2, \"C\": 0}, \"\\uac00\": 3, \"z\": 4, \"\\u00e9\": 5, \"\\ue000\": 6, \"\\ud83d\\ude00\": 7, \"_\": 8, \"A b\": 9}",
   "{\"A b\": 9, \"B\": 2, \"_\": 8, \"a\": {\"C\": 0, \"c\": 2, \"d\": 1}, \"b\": 1, \"z\": 4, \"\\u00e9\": 5, \"\\uac00\": 3, \"\\ue000\": 6, \"\\ud83d\\ude00\": 7}",
   "{\"b\": 1, \"B\": 2, \"a\": {\"d\": 1, \"c\": 2, \"C\": 0}, \"\uac00\": 3, \"z\": 4, \"\u00e9\": 5, \"\ue000\": 6, \"\ud83d\ude00\": 7, \"_\": 8, \"A b\": 9}",
   "{\"A b\": 9, \"B\": 2, \"_\": 8, \"a\": {\"C\": 0, \"c\": 2, \"d\": 1}, \"b\": 1, \"z\": 4, \"\u00e9\": 5, \"\uac00\": 3, \"\ue000\": 6, \"\ud83d\ude00\": 7}",
   "{\n\"b\": 1,\n\"B\": 2,\n\"a\": {\n\"d\": 1,\n\"c\": 2,\n\"C\": 0\n},\n\"\\uac00\": 3,\n\"z\": 4,\n\"\\u00e9\": 5,\n\"\\ue000\": 6,\n\"\\ud83d\\ude00\": 7,\n\"_\": 8,\n\"A b\": 9\n}",
   "{\n\"A b\": 9,\n\"B\": 2,\n\"_\": 8,\n\"a\": {\n\"C\": 0,\n\"c\": 2,\n\"d\": 1\n},\n\"b\": 1,\n\"z\": 4,\n\"\\u00e9\": 5,\n\"\\uac00\": 3,\n\"\\ue000\": 6,\n\"\\ud83d\\ude00\": 7\n}",
   "{\n\"b\": 1,\n\"B\": 2,\n\"a\": {\n\"d\": 1,\n\"c\": 2,\n\"C\": 0\n},\n\"\uac00\": 3,\n\"z\": 4,\n\"\u00e9\": 5,\n\"\ue000\": 6,\n\"\ud83d\ude00\": 7,\n\"_\": 8,\n\"A b\": 9\n}",
   "{\n\"A b\": 9,\n\"B\": 2,\n\"_\": 8,\n\"a\": {\n\"C\": 0,\n\"c\": 2,\n\"d\": 1\n},\n\"b\": 1,\n\"z\": 4,\n\"\u00e9\": 5,\n\"\uac00\": 3,\n\"\ue000\": 6,\n\"\ud83d\ude00\": 7\n}",
   "{\n \"b\": 1,\n \"B\": 2,\n \"a\": {\n  \"d\": 1,\n  \"c\": 2,\n  \"C\": 0\n },\n \"\\uac00\": 3,\n \"z\": 4,\n \"\\u00e9\": 5,\n \"\\ue000\": 6,\n \"\\ud83d\\ude00\": 7,\n \"_\": 8,\n \"A b\": 9\n}",
   "{\n \"A b\": 9,\n \"B\": 2,\n \"_\": 8,\n \"a\": {\n  \"C\": 0,\n  \"c\": 2,\n  \"d\": 1\n },\n \"b\": 1,\n \"z\": 4,\n \"\\u00e9\": 5,\n \"\\uac00\": 3,\n \"\\ue000\": 6,\n \"\\ud83d\\ude00\": 7\n}",
   "{\n \"b\": 1,\n \"B\": 2,\n \"a\": {\n  \"d\": 1,\n  \"c\": 2,\n  \"C\": 0\n },\n \"\uac00\": 3,\n \"z\": 4,\n \"\u00e9\": 5,\n \"\ue000\": 6,\n \"\ud83d\ude00\": 7,\n \"_\": 8,\n \"A b\": 9\n}",
   "{\n \"A b\": 9,\n \"B\": 2,\n \"_\": 8,\n \"a\": {\n  \"C\": 0,\n  \"c\": 2,\n  \"d\": 1\n },\n \"b\": 1,\n \"z\": 4,\n \"\u00e9\": 5,\n \"\uac00\": 3,\n \"\ue000\": 6,\n \"\ud83d\ude00\": 7\n}",
   "{\n  \"b\": 1,\n  \"B\": 2,\n  \"a\": {\n    \"d\": 1,\n    \"c\": 2,\n    \"C\": 0\n  },\n  \"\\uac00\": 3,\n  \"z\": 4,\n  \"\\u00e9\": 5,\n  \"\\ue000\": 6,\n  \"\\ud83d\\ude00\": 7,\n  \"_\": 8,\n  \"A b\": 9\n}",
   "{\n  \"A b\": 9,\n  \"B\": 2,\n  \"_\": 8,\n  \"a\": {\n    \"C\": 0,\n    \"c\": 2,\n    \"d\": 1\n  },\n  \"b\": 1,\n  \"z\": 4,\n  \"\\u00e9\": 5,\n  \"\\uac00\": 3,\n  \"\\ue000\": 6,\n  \"\\ud83d\\ude00\": 7\n}",
   "{\n  \"b\": 1,\n  \"B\": 2,\n  \"a\": {\n    \"d\": 1,\n    \"c\": 2,\n    \"C\": 0\n  },\n  \"\uac00\": 3,\n  \"z\": 4,\n  \"\u00e9\": 5,\n  \"\ue000\": 6,\n  \"\ud83d\ude00\": 7,\n  \"_\": 8,\n  \"A b\": 9\n}",
   "{\n  \"A b\": 9,\n  \"B\": 2,\n  \"_\": 8,\n  \"a\": {\n    \"C\": 0,\n    \"c\": 2,\n    \"d\": 1\n  },\n  \"b\": 1,\n  \"z\": 4,\n  \"\u00e9\": 5,\n  \"\uac00\": 3,\n  \"\ue000\": 6,\n  \"\ud83d\ude00\": 7\n}"
  ],
  "listdicts": [
   "[{\"id\": 1, \"tags\": [\"a\", \"b\"]}, {\"id\": 2, \"tags\": []}, {}]",
   "[{\"id\": 1, \"tags\": [\"a\", \"b\"]}, {\"id\": 2, \"tags\": []}, {}]",
   "[{\"id\": 1, \"tags\": [\"a\", \"b\"]}, {\"id\": 2, \"tags\": []}, {}]",
   "[{\"id\": 1, \"tags\": [\"a\", \"b\"]}, {\"id\": 2, \"tags\": []}, {}]",
   "[\n{\n\"id\": 1,\n\"tags\": [\n\"a\",\n\"b\"\n]\n},\n{\n\"id\": 2,\n\"tags\": []\n},\n{}\n]",
   "[\n{\n\"id\": 1,\n\"tags\": [\n\"a\",\n\"b\"\n]\n},\n{\n\"id\": 2,\n\"tags\": []\n},\n{}\n]",
   "[\n{\n\"id\": 1,\n\"tags\": [\n\"a\",\n\"b\"\n]\n},\n{\n\"id\": 2,\n\"tags\": []\n},\n{}\n]",
   "[\n{\n\"id\": 1,\n\"tags\": [\n\"a\",\n\"b\"\n]\n},\n{\n\"id\": 2,\n\"tags\": []\n},\n{}\n]",
   "[\n {\n  \"id\": 1,\n  \"tags\": [\n   \"a\",\n   \"b\"\n  ]\n },\n {\n  \"id\": 2,\n  \"tags\": []\n },\n {}\n]",
   "[\n {\n  \"id\": 1,\n  \"tags\": [\n   \"a\",\n   \"b\"\n  ]\n },\n {\n  \"id\": 2,\n  \"tags\": []\n },\n {}\n]",
   "[\n {\n  \"id\": 1,\n  \"tags\": [\n   \"a\",\n   \"b\"\n  ]\n },\n {\n  \"id\": 2,\n  \"tags\": []\n },\n {}\n]",
   "[\n {\n  \"id\": 1,\n  \"tags\": [\n   \"a\",\n   \"b\"\n  ]\n },\n {\n  \"id\": 2,\n  \"tags\": []\n },\n {}\n]",
   "[\n  {\n    \"id\": 1,\n    \"tags\": [\n      \"a\",\n      \"b\"\n    ]\n  },\n  {\n    \"id\": 2,\n    \"tags\": []\n  },\n  {}\n]",
   "[\n  {\n    \"id\": 1,\n    \"tags\": [\n      \"a\",\n      \"b\"\n    ]\n  },\n  {\n    \"id\": 2,\n    \"tags\": []\n  },\n  {}\n]",
   "[\n  {\n    \"id\": 1,\n    \"tags\": [\n      \"a\",\n      \"b\"\n    ]\n  },\n  {\n    \"id\": 2,\n    \"tags\": []\n  },\n  {}\n]",
   "[\n  {\n    \"id\": 1,\n    \"tags\": [\n      \"a\",\n      \"b\"\n    ]\n  },\n  {\n    \"id\": 2,\n    \"tags\": []\n  },\n  {}\n]"
  ],
  "top_str": [
   "\"\\ud55c\\uae00 \\u0001 \\\"x\\\"\"",
   "\"\\ud55c\\uae00 \\u0001 \\\"x\\\"\"",
   "\"\ud55c\uae00 \\u0001 \\\"x\\\"\"",
   "\"\ud55c\uae00 \\u0001 \\\"x\\\"\"",
   "\"\\ud55c\\uae00 \\u0001 \\\"x\\\"\"",
   "\"\\ud55c\\uae00 \\u0001 \\\"x\\\"\"",
   "\"\ud55c\uae00 \\u0001 \\\"x\\\"\"",
   "\"\ud55c\uae00 \\u0001 \\\"x\\\"\"",
   "\"\\ud55c\\uae00 \\u0001 \\\"x\\\"\"",
   "\"\\ud55c\\uae00 \\u0001 \\\"x\\\"\"",
   "\"\ud55c\uae00 \\u0001 \\\"x\\\"\"",
   "\"\ud55c\uae00 \\u0001 \\\"x\\\"\"",
   "\"\\ud55c\\uae00 \\u0001 \\\"x\\\"\"",
   "\"\\ud55c\\uae00 \\u0001 \\\"x\\\"\"",
   "\"\ud55c\uae00 \\u0001 \\\"x\\\"\"",
   "\"\ud55c\uae00 \\u0001 \\\"x\\\"\""
  ],
  "top_num": [
   "42",
   "42",
   "42",
   "42",
   "42",
   "42",
   "42",
   "42",
   "42",
   "42",
   "42",
   "42",
   "42",
   "42",
   "42",
   "42"
  ],
  "top_null": [
   "null",
   "null",
   "null",
   "null",
   "null",
   "null",
   "null",
   "null",
   "null",
   "null",
   "null",
   "null",
   "null",
   "null",
   "null",
   "null"
  ],
  "top_emptylist": [
   "[]",
   "[]",
   "[]",
   "[]",
   "[]",
   "[]",
   "[]",
   "[]",
   "[]",
   "[]",
   "[]",
   "[]",
   "[]",
   "[]",
   "[]",
   "[]"
  ],
  "top_emptydict": [
   "{}",
   "{}",
   "{}",
   "{}",
   "{}",
   "{}",
   "{}",
   "{}",
   "{}",
   "{}",
   "{}",
   "{}",
   "{}",
   "{}",
   "{}",
   "{}"
  ]
 },
 "floats": [
  "0.1",
  "1.0",
  "100.0",
  "1e15",
  "1e16",
  "1e22",
  "1.5e-5",
  "0.0001",
  "0.00001",
  "123456789012345.0",
  "1234567890123456.0",
  "12345678901234567.0",
  "5e-324",
  "1.7976931348623157e308",
  "-0.0",
  "0.0",
  "3.141592653589793",
  "1e-7",
  "12345.678",
  "nan",
  "inf",
  "-inf",
  "2.5",
  "1e100",
  "123456789012345680000.0",
  "0.1e-3",
  "-1.5e300",
  "9.999999999999999e22"
 ],
 "floatExpected": [
  "0.1",
  "1.0",
  "100.0",
  "1000000000000000.0",
  "1e+16",
  "1e+22",
  "1.5e-05",
  "0.0001",
  "1e-05",
  "123456789012345.0",
  "1234567890123456.0",
  "1.2345678901234568e+16",
  "5e-324",
  "1.7976931348623157e+308",
  "-0.0",
  "0.0",
  "3.141592653589793",
  "1e-07",
  "12345.678",
  "NaN",
  "Infinity",
  "-Infinity",
  "2.5",
  "1e+100",
  "1.2345678901234568e+20",
  "0.0001",
  "-1.5e+300",
  "1e+23"
 ]
};
// <<GEN:END>>

const jsOpts = (o) => ({ indent: o.indent, ensureAscii: o.ea, sortKeys: o.sk });
const jsValue = (c) => JSON.parse(c.text);

test('pyJsonDumps: 표본 x 옵션 조합이 python 으로 미리 계산한 값과 같다', () => {
  for (const c of DATA.cases) {
    DATA.opts.forEach((o, i) => {
      assert.equal(pyJsonDumps(jsValue(c), jsOpts(o)), DATA.expected[c.name][i],
        `${c.name} / ${JSON.stringify(o)}`);
    });
  }
});

test('pyJsonDumps: float(PyFloat) 표본이 python repr 과 같다', () => {
  DATA.floats.forEach((s, i) => {
    const x = s === 'nan' ? NaN : s === 'inf' ? Infinity : s === '-inf' ? -Infinity : Number(s);
    assert.equal(pyJsonDumps([pyFloat(x)]), `[${DATA.floatExpected[i]}]`, s);
    assert.equal(pyFloatRepr(x), DATA.floatExpected[i], s);
  });
});

test('pyJsonDumps: python 이 있으면 실제 json.dumps 와 바이트 비교', (t) => {
  const py = findPython();
  if (!py) return t.skip('python3 없음');
  const script = [
    'import sys, json',
    'req = json.load(sys.stdin)',
    'out = []',
    'for c in req["cases"]:',
    '    v = json.loads(c["text"])',
    '    for o in req["opts"]:',
    '        out.append(json.dumps(v, indent=o["indent"], ensure_ascii=o["ea"], sort_keys=o["sk"]))',
    'for s in req["floats"]:',
    '    out.append(json.dumps([float(s)]))',
    'print(json.dumps(out))',
  ].join('\n');
  const r = runCommand(py, ['-c', script], {
    input: JSON.stringify({ cases: DATA.cases, opts: DATA.opts, floats: DATA.floats }),
    env: { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  });
  assert.equal(r.status, 0, r.stderr);
  const pyOut = JSON.parse(r.stdout);
  let k = 0;
  for (const c of DATA.cases) {
    for (const o of DATA.opts) {
      assert.equal(pyJsonDumps(jsValue(c), jsOpts(o)), pyOut[k++], `${c.name} / ${JSON.stringify(o)}`);
    }
  }
  for (const s of DATA.floats) {
    const x = s === 'nan' ? NaN : s === 'inf' ? Infinity : s === '-inf' ? -Infinity : Number(s);
    assert.equal(pyJsonDumps([pyFloat(x)]), pyOut[k++], s);
  }
});

test('Map 은 삽입순을 유지하고, 일반 객체의 정수형 키는 JS 가 재배치한다(문서화된 한계)', () => {
  const m = new Map([['10', 1], ['2', 2], ['1', 3]]);
  assert.equal(pyJsonDumps(m), '{"10": 1, "2": 2, "1": 3}');
  assert.equal(pyJsonDumps(m, { sortKeys: true }), '{"1": 3, "10": 1, "2": 2}'); // 문자열 코드포인트 순
  assert.equal(pyJsonDumps({ '10': 1, '2': 2 }), '{"2": 2, "10": 1}'); // 한계: python 은 {"10": 1, "2": 2}
  assert.equal(pyJsonDumps(new Map([[1, 'a'], [true, 'b'], [null, 'c']])), '{"1": "a", "true": "b", "null": "c"}');
});

test('정수형 float 한계와 PyFloat 보정', () => {
  assert.equal(pyJsonDumps([1.0, 2, -0]), '[1, 2, 0]'); // 한계: 정수는 정수로
  assert.equal(pyJsonDumps([pyFloat(1), new PyFloat(-0)]), '[1.0, -0.0]');
  assert.equal(pyJsonDumps([9007199254740991, 12345678901234567890n]), '[9007199254740991, 12345678901234567890]');
});

test('지원하지 않는 값은 TypeError', () => {
  assert.throws(() => pyJsonDumps({ a: undefined }), TypeError);
  assert.throws(() => pyJsonDumps(new Set([1])), TypeError);
  const cyc = []; cyc.push(cyc);
  assert.throws(() => pyJsonDumps(cyc), TypeError);
});
