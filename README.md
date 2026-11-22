# calorie-daily
קלוריות ביום — אפליקציית יומן קלוריות להתקנה דרך כרום

To rebuild the local Israeli barcode catalog, download the Israel TSV from the Open Food Facts export URL in NOTICE.txt and run:
```sh
python3 import-israeli-products.py /path/to/israel-export.tsv israeli-barcode-data.js
```
The importer keeps products with a valid barcode, a name, and a declared energy value for 100 g or 100 mL. Product-specific corrections live in retail-foods.js.
