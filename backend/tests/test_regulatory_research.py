from app.modules.regulatory.research import _lookup_names, valid_cas


def test_cas_checksum_rejects_ec_number_with_same_shape() -> None:
    assert valid_cas("24851-98-7")
    assert not valid_cas("246-495-9")


def test_common_regulatory_name_variants() -> None:
    assert _lookup_names("ISO BORNYL ACETATE") == ["ISO BORNYL ACETATE", "ISOBORNYL ACETATE"]
    assert _lookup_names("TERPINYL ACETATE") == ["TERPINYL ACETATE", "alpha-terpinyl acetate"]
    assert _lookup_names("CARRYOPHELLENE OXIDE SS")[1] == "CARYOPHYLLENE OXIDE"
    assert _lookup_names("DHM")[1] == "dihydromyrcenol"
