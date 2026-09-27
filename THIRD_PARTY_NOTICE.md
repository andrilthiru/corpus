# Third-party / research notice

## Iyal Tamil Spellchecker resources

This prototype uses the public word-bank resources from the Kaniyam Foundation
Iyal Tamil Spellchecker project as Tamil lexical evidence.

Project:
https://github.com/KaniyamFoundation/iyal-tamil-spellchecker

The Iyal public site states that the project is released under the Apache
License 2.0. Preserve upstream attribution and review the repository's current
license terms before production redistribution.

## DDSpell

Reference:
Uthayamoorthy, K.; Kanthasamy, K.; Senthaalan, T.; Sarveswaran, K.; Dias, G.
"DDSpell - A Data Driven Spell Checker and Suggestion Generator for the Tamil
Language", ICTer 2019.

v0.11.4 does NOT bundle or claim to run the original DDSpell source code.
It implements the published core ranking signals (bigram similarity, minimum
edit distance and word frequency) and labels the result `ddspell_style`.

## Sarvam / Google Gemini

Used through their respective hosted APIs. API credentials remain server-side.
