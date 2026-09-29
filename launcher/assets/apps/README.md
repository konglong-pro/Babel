# Desktop notebook logos

These 96 × 96 PNGs are WPF-compatible copies of each notebook's
`apps/<id>/src/app/icon.svg`. The desktop shell keeps the Babel icon for its
Windows identity, while notebook tabs and the application list use these marks.

When an app's logo changes, regenerate its copy with the existing installed `sharp`
package, resizing the SVG to 96 × 96. Neum omits the SVG's pale
background rectangle so its coordinate axes match the mark in the app header.
New registered apps without a desktop logo still display their names normally.
