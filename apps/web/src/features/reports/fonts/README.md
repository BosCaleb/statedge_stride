# PDF fonts

jsPDF embeds TrueType fonts, not the WOFF2 files the app uses, so the report PDF carries its own
copies of Inter and Oswald, under the SIL Open Font License (`OFL-Inter.txt`, `OFL-Oswald.txt`).
They are imported only by the lazily loaded PDF module.

- `Inter-Regular.ttf`, `Inter-SemiBold.ttf`: static instances (weight 400 and 600, optical size 14) of `ofl/inter/Inter[opsz,wght].ttf` from github.com/google/fonts.
- `Oswald-Bold.ttf`: `fonts/ttf/Oswald-Bold.ttf` from github.com/googlefonts/OswaldFont.

Each is subset to Basic Latin, Latin-1, a few Latin Extended letters, typographic quotes and
dashes, the bullet, ellipsis, prime marks, euro, trade mark, minus and degree signs, keeping the
kern and liga features. Made with fontTools (`fontTools.varLib.instancer` for Inter, then
`fontTools.subset`). The characters the PDF can draw are listed in `pdfFonts.ts`.
