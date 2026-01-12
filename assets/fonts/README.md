# JetBrains Mono Font Files

This directory should contain JetBrains Mono font files for bundling with the extension.

## Required Files

Download the following from [JetBrains Mono official releases](https://github.com/JetBrains/JetBrainsMono/releases):

1. `JetBrainsMono-Regular.woff2`
2. `JetBrainsMono-Medium.woff2`
3. `JetBrainsMono-Bold.woff2`

## Installation

1. Download the latest JetBrains Mono release
2. Extract the fonts from the `fonts/webfonts/` directory
3. Copy the `.woff2` files to this directory
4. The extension will automatically load them via `@font-face` declarations in `styles.css`

## File Sizes

- Each `.woff2` file is approximately 100-150KB
- Total bundle size: ~300-450KB
- Benefits: Offline reliability, consistent rendering across all systems

## License

JetBrains Mono is licensed under the OFL-1.1 (Open Font License)
