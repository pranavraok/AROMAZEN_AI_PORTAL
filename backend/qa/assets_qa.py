from collections import Counter
from datetime import date, timedelta

from app.modules.assets.models import ITAsset
from app.modules.assets.routes import maintenance_status
from app.modules.assets.service import ASSET_TEMPLATE_PATH, read_asset_rows


def main() -> None:
    rows = read_asset_rows(ASSET_TEMPLATE_PATH)
    assert len(rows) == 81
    statuses = Counter(row["status"] for row in rows)
    assert statuses == {"Active": 78, "Recovery required": 1, "Scrap proposed": 1, "Spare": 1}
    assert all(row["invoice_date_raw"] != "#VALUE!" for row in rows)

    today = date(2026, 8, 10)
    item = ITAsset(
        organization_id=None,
        asset_key="qa",
        status="Active",
        condition="Good",
        next_maintenance_date=today + timedelta(days=15),
        maintenance_reminder_days=30,
    )
    assert maintenance_status(item, today) == ("due", 15)
    item.next_maintenance_date = today - timedelta(days=2)
    assert maintenance_status(item, today) == ("overdue", -2)
    item.status = "Scrapped"
    assert maintenance_status(item, today) == ("not_scheduled", None)
    print("Asset register and maintenance QA passed")


if __name__ == "__main__":
    main()

