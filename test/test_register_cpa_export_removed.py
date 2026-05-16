from __future__ import annotations

import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.accounts as accounts_module


AUTH_HEADERS = {"Authorization": "Bearer test-admin"}


class CpaOutputRemovalTests(unittest.TestCase):
    def test_register_config_no_longer_exposes_cpa_auto_import(self) -> None:
        from services.register_service import _default_config

        config = _default_config()

        self.assertNotIn("cpa_auto_import", config)

    def test_accounts_api_no_longer_exposes_cpa_export_route(self) -> None:
        app = FastAPI()
        app.include_router(accounts_module.create_router())
        client = TestClient(app)

        response = client.post(
            "/api/accounts/export/cpa",
            headers=AUTH_HEADERS,
            json={"access_tokens": ["token-one"]},
        )

        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
