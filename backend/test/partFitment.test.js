const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalise,
  normaliseBrand,
  normaliseModel,
  resolveLaptopIdentity,
  setKnownBrands,
  fits,
  rankByFit,
  validateFitment,
  FitmentValidationError,
  FITMENT,
} = require('../services/partFitmentService');

// The laptop brand master as it stands on staging (asset_config_brands).
setKnownBrands(['Dell', 'HP', 'Lenovo', 'Apple', 'Asus', 'Acer', 'Samsung', 'Other', 'Compatible']);

describe('partFitmentService.normalise', () => {
  it('lowercases, trims, collapses whitespace, treats -_/ as space', () => {
    assert.equal(normalise('  Latitude-5420 '), 'latitude 5420');
    assert.equal(normalise('LATITUDE  5420'), 'latitude 5420');
    assert.equal(normalise('latitude_5420'), 'latitude 5420');
    assert.equal(normalise('Latitude/5420'), 'latitude 5420');
    assert.equal(normalise('Latitude 5420, (Touch)'), 'latitude 5420 touch');
    assert.equal(normalise(null), '');
  });
});

describe('partFitmentService.fits — §2.3 table', () => {
  const dell5420 = {
    fitment: 'specific',
    fits_laptop_brand: 'Dell',
    fits_laptop_models: ['Latitude 5420', 'Latitude 5410'],
  };
  const dellOnly = {
    fitment: 'specific',
    fits_laptop_brand: 'Dell',
    fits_laptop_models: [],
  };
  const dell5420Only = {
    fitment: 'specific',
    fits_laptop_brand: 'Dell',
    fits_laptop_models: ['Latitude 5420'],
  };

  it('specific Dell {5420,5410} fits Dell Latitude 5420', () => {
    assert.equal(fits(dell5420, 'Dell', 'Latitude 5420'), 'fit');
  });

  it('specific Dell {5420} unfit for Dell Vostro 3400', () => {
    assert.equal(fits(dell5420Only, 'Dell', 'Vostro 3400'), 'unfit');
  });

  it('specific Dell {} fits every Dell (brand-only)', () => {
    assert.equal(fits(dellOnly, 'Dell', 'Vostro 3400'), 'fit');
  });

  it('specific Dell {} unfit for Lenovo', () => {
    assert.equal(fits(dellOnly, 'Lenovo', 'ThinkPad T14'), 'unfit');
  });

  it('universal fits everything', () => {
    assert.equal(fits({ fitment: 'universal' }, 'Lenovo', 'ThinkPad T14'), 'fit');
  });

  it('unset always unknown', () => {
    assert.equal(fits({ fitment: 'unset' }, 'Dell', 'Latitude 5420'), 'unknown');
    assert.equal(fits({ fitment: 'unset' }, null, null), 'unknown');
  });

  it('specific with empty laptop brand → unknown', () => {
    assert.equal(fits(dell5420Only, '', 'Latitude 5420'), 'unknown');
    assert.equal(fits(dell5420Only, null, 'Latitude 5420'), 'unknown');
  });

  it('norm makes Latitude-5420 match Latitude 5420', () => {
    assert.equal(fits(dell5420Only, 'dell', 'Latitude-5420'), 'fit');
    assert.equal(fits(dell5420Only, 'DELL', 'LATITUDE  5420'), 'fit');
  });

  it('specific Dell {5420} unfit for HP', () => {
    assert.equal(fits(dell5420Only, 'HP', 'ProBook 640 G5'), 'unfit');
  });

  it('specific with models but empty laptop model → unknown', () => {
    assert.equal(fits(dell5420Only, 'Dell', ''), 'unknown');
  });
});

describe('partFitmentService.validateFitment', () => {
  it('universal clears brand and models', () => {
    const v = validateFitment({
      fitment: 'universal',
      fits_laptop_brand: 'Dell',
      fits_laptop_models: ['X'],
    });
    assert.equal(v.fitment, 'universal');
    assert.equal(v.fits_laptop_brand, null);
    assert.equal(v.fits_laptop_models, null);
  });

  it('specific requires brand', () => {
    assert.throws(
      () => validateFitment({ fitment: 'specific', fits_laptop_brand: null }),
      FitmentValidationError
    );
  });

  it('unset clears fields', () => {
    const v = validateFitment({
      fitment: 'unset',
      fits_laptop_brand: 'Dell',
      fits_laptop_models: ['X'],
    });
    assert.equal(v.fitment, 'unset');
    assert.equal(v.fits_laptop_brand, null);
  });
});

describe('brand/model normalisation against real staging strings', () => {
  it('treats company forms as the same brand', () => {
    assert.equal(normaliseBrand('Dell Inc.'), 'dell');
    assert.equal(normaliseBrand('DELL'), 'dell');
    assert.equal(normaliseBrand('Hewlett-Packard'), 'hp');
    assert.equal(normaliseBrand('Lenovo Group Ltd'), 'lenovo');
  });

  it('drops marketing suffixes from a model', () => {
    assert.equal(normaliseModel('ProBook 640 G5 Notebook PC'), 'probook 640 g5');
    assert.equal(normaliseModel('EliteBook 640 14 inch G11 Notebook'), 'elitebook 640 14 inch g11');
  });

  it('strips brand prefixes, however many times they repeat', () => {
    assert.deepEqual(resolveLaptopIdentity('HP', 'HP Probook 430 G3'), { brand: 'hp', model: 'probook 430 g3' });
    assert.deepEqual(
      resolveLaptopIdentity('HP', 'HP HP EliteBook 640 14 inch G9 Notebook PC'),
      { brand: 'hp', model: 'elitebook 640 14 inch g9' }
    );
    assert.deepEqual(resolveLaptopIdentity('Dell', 'Dell Inc. Latitude 7440'), { brand: 'dell', model: 'latitude 7440' });
  });

  it('believes the model over a contradicting ticket brand', () => {
    // staging has 1180 tickets stamped "Dell" regardless of the actual machine
    assert.deepEqual(resolveLaptopIdentity('Dell', 'Dell Lenovo Thinkpad X-13'), { brand: 'lenovo', model: 'thinkpad x 13' });
    assert.deepEqual(resolveLaptopIdentity('Dell', 'HP Probook 640 G4'), { brand: 'hp', model: 'probook 640 g4' });
  });

  it('never infers a placeholder brand from a model', () => {
    assert.equal(resolveLaptopIdentity('Other', 'Other 1234').brand, '');
  });
});

describe('fits() on the strings that actually reach the pick list', () => {
  const hpProbook = { fitment: 'specific', fits_laptop_brand: 'HP', fits_laptop_models: ['Probook 840 G8'] };
  const dellAny = { fitment: 'specific', fits_laptop_brand: 'Dell', fits_laptop_models: [] };

  it('matches despite prefixes, case and suffixes', () => {
    assert.equal(fits(hpProbook, 'HP', 'Probook 840 G8'), 'fit');
    assert.equal(fits(hpProbook, 'HP', 'HP ProBook 840 G8'), 'fit');
    assert.equal(fits(hpProbook, 'HP', 'HP HP Probook 840 G8 Notebook PC'), 'fit');
    assert.equal(fits(dellAny, 'Dell Inc.', 'Latitude 7440'), 'fit');
  });

  it('matches a master tag that carries its own brand prefix', () => {
    const tagged = { fitment: 'specific', fits_laptop_brand: 'HP', fits_laptop_models: ['HP Probook 430 G3'] };
    assert.equal(fits(tagged, 'HP', 'Probook 430 G3'), 'fit');
  });

  it('still rejects a genuine mismatch', () => {
    assert.equal(fits(hpProbook, 'Lenovo', 'Thinkpad T14'), 'unfit');
    assert.equal(fits(hpProbook, 'HP', 'Elitebook 840 G8'), 'unfit');
    assert.equal(fits(dellAny, 'HP', 'Probook 640 G5'), 'unfit');
  });

  it('is unknown, never unfit, when the laptop brand is unusable', () => {
    assert.equal(fits(hpProbook, '', 'Probook 840 G8'), 'unknown');
    assert.equal(fits(hpProbook, null, null), 'unknown');
    assert.equal(fits(hpProbook, 'HP', ''), 'unknown');
  });
});

describe('rankByFit', () => {
  it('puts fitting units first and mismatches last', () => {
    const units = [
      { instance_id: 1, fitment: 'specific', fits_laptop_brand: 'Lenovo', fits_laptop_models: [] },
      { instance_id: 2, fitment: 'unset' },
      { instance_id: 3, fitment: 'specific', fits_laptop_brand: 'HP', fits_laptop_models: [] },
      { instance_id: 4, fitment: 'universal' },
    ];
    const ranked = rankByFit(units, 'HP', 'Probook 840 G8');
    assert.deepEqual(ranked.map((r) => r.unit.instance_id), [3, 4, 2, 1]);
    assert.deepEqual(ranked.map((r) => r.fit_status), ['fit', 'fit', 'unknown', 'unfit']);
  });
});

describe('unset never blocks (acceptance #1 helper)', () => {
  for (const stage of ['filter', 'warn', 'block']) {
    it(`unset is unknown at conceptual stage ${stage}`, () => {
      assert.equal(fits({ fitment: FITMENT.UNSET }, 'Dell', 'Latitude 5420'), 'unknown');
    });
  }
});
