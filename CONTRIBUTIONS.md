# Contributing

If you are a new contributor wanting to make a larger contribution,
 please first discuss the change you wish to make via
 an issue or [Discord](https://discord.gg/AjTPFpN) before making a pull request.

## Code contributions

See [DEVELOPMENT.md](DEVELOPMENT.md) for how the app is organized, built and tested.
Run `npm run typecheck` and `npm test` before sending a pull request.

## Translations

### Contributing to an existing translation

* Locate the `.po` file for your language in [`src/i18n`](src/i18n).
* Correct the relevant `msgstr` entries.

### Adding a translation

Adding a translation requires making a new `.po` file with entries for that language.

* Copy the English file, [`src/i18n/en.po`](src/i18n/en.po).
* Change all the `msgstr` entries to your target language.
    * Note that anything between `{}` should be left as-is.
    * The information at the top of the file should also not be translated.
* Add the language to `LANGUAGES` in `src/ui/i18nLoader.ts`.

# Contributors 

## Primary author and project maintainer:

[Sander Land](https://github.com/sanderland/)

## Contributors

Many thanks to these additional authors:

* Matthew Allred ("Kameone") for design of the v1.1 UI, macOS installation instructions, and working on promotion and YouTube videos.
* "bale-go" for development and continued work on the 'calibrated rank' AI and rank estimation algorithm.
* "Dontbtme" for detailed feedback and early testing of v1.0+.
* "nowoowoo" for a fix to the parser for SGF files with extra line breaks.
* "nimets123" for the timer sound effects and board/stone graphics.
* Jordan Seaward for the stone sound effects.
* "fohristiwhirl" for the Gibo and NGF formats parsing code.
* "kaorahi" for bug fixes, SGF parser improvements, and tsumego frame code.
* "ajkenny84" for the red-green colourblind theme.
* Lukasz Wierzbowski for the ability to paste urls for sgfs and helping fix alt-gr issues.
* Carton He for contributions to sgf parsing and handling.
* "blamarche" for adding the board coordinates toggle.
* "pdeblanc" for adding the ancient chinese scoring option, fixing a bug in query termination, and high precision score display.
* "LiamHz" for adding the 'back to main branch' keyboard shortcut.
* "xiaoyifang" for adding the reset analysis option, feature to save options on the loading screen, and scrolling through variations.
* "electricRGB" for help with adding configurable keyboard shortcuts.
* "milescrawford" for work on restyling the territory estimate.
* "Funkenschlag1" for capturing stones sound and implementation, and board rotation.
* "waltheri" for one of the wooden board textures.
* Jacob Minsky ("jacobm-tech") for various contributions including analysis move range and improvements to territory display.

## Translators

Many thanks to the following contributors for translations.

* French: "Dontbtme" with contributions from "wonderingabout"
* Korean: "isty2e"
* German: "nimets123", "trohde", "Harleqin" and "Sovereign"
* Spanish: Sergio Villegas ("serpiente") with contributions from the Spanish OGS community
* Russian: Dmitry Ivankov and Alexander Kiselev
* Simplified Chinese: Qing Mu with contributions from "Medwin" and Viktor Lin
* Japanese: "kaorahi"
* Traditional Chinese: "Tony-Liou" with contributions from Ching-yu Lin

## Additional thanks to

* David Wu ("lightvector") for creating KataGo and providing assistance with making the most of KataGo's amazing capabilities.
* "세븐틴" for including KaTrain in the Baduk Megapack and making explanatory YouTube videos in Korean.

