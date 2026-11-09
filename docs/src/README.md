# How the README images are made

- `cover.html` draws the README cover (1280×640) from the stress-test numbers in `docs/stress-test.md` and a real screenshot of the demo.
- `docs/how-it-works.svg` is plain SVG, edited by hand.
- The screenshots and GIFs in `docs/assets/` are recordings of `pnpm demo` (`?auto=1` presses Approve on its own).

```bash
cd docs/src
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1280,640 --allow-file-access-from-files \
  --screenshot="$PWD/../assets/cover.png" "file://$PWD/cover.html"
```
