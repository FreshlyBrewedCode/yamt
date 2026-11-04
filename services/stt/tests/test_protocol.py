import json

import pytest

from yamt_stt.protocol import Item, RequestError, Settings, parse_request


def test_defaults_are_the_spike_setup():
    settings, items = parse_request(json.dumps({"items": []}))
    assert settings == Settings(
        model="large-v3-turbo", compute_type="int8", threads=4, beam_size=1, vad=True, language="de"
    )
    assert items == []


def test_settings_and_items():
    settings, items = parse_request(
        json.dumps(
            {
                "settings": {
                    "model": "tiny",
                    "computeType": "int8_float32",
                    "threads": 2,
                    "beamSize": 5,
                    "vad": False,
                    "initialPrompt": "Haferflocken, Skyr",
                    "modelsDir": "/tmp/models",
                },
                "items": [{"id": "a", "path": "/tmp/a.wav"}],
            }
        )
    )
    assert settings.model == "tiny" and settings.threads == 2 and settings.beam_size == 5
    assert settings.vad is False and settings.initial_prompt == "Haferflocken, Skyr"
    assert items == [Item("a", "/tmp/a.wav")]


@pytest.mark.parametrize(
    "req",
    [
        "not json",
        "[]",
        '{"items": {}}',
        '{"items": [{"id": 1, "path": "x"}]}',
        '{"settings": {"threads": true}, "items": []}',
        '{"settings": {"threads": 0}, "items": []}',
        '{"settings": {"vad": "yes"}, "items": []}',
    ],
)
def test_bad_requests(req):
    with pytest.raises(RequestError):
        parse_request(req)
