const test = require("node:test");
const assert = require("node:assert/strict");
const {
  productIdFromUrl,
  readNuxtProductData,
  validBarcode
} = require("../lib/extractor.js");

function fakeDocument(payload) {
  return {
    querySelector(selector) {
      return selector === "#__NUXT_DATA__" ? { textContent: JSON.stringify(payload) } : null;
    }
  };
}

test("čita ean_code iz Nuxt referenciranog payloada", () => {
  const payload = [
    null,
    { code: 2, title: 3, ean_code: 4 },
    "5000311742",
    "Laptop HP 250R G10",
    "2010033161096"
  ];

  assert.deepEqual(readNuxtProductData(fakeDocument(payload), "5000311742"), {
    barcode: "2010033161096",
    name: "Laptop HP 250R G10"
  });
});

test("odbacuje barkod koji nije numerički ili je pogrešne duljine", () => {
  assert.equal(validBarcode("3851234567890"), "3851234567890");
  assert.equal(validBarcode("ABC-123"), null);
  assert.equal(validBarcode("1234567"), null);
});

test("čita Big Bang ID iz produktnog URL-a", () => {
  assert.equal(
    productIdFromUrl("https://www.bigbang.hr/laptop-hp-250r-p-5000311742/"),
    "5000311742"
  );
});
