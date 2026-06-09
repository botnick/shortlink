# OG card fonts

Subset (Latin + Thai + punctuation) woff2 fonts used **only** for client-side
OG-image generation. Loaded on demand via the FontFace API — they never touch
the redirect path or the initial SPA bundle.

All families are licensed under the **SIL Open Font License 1.1** (see `OFL.txt`):

| File prefix            | Family                     | Copyright |
| ---------------------- | -------------------------- | --------- |
| `ibm-plex-thai`        | IBM Plex Sans Thai         | © IBM Corp. |
| `ibm-plex-thai-looped` | IBM Plex Sans Thai Looped  | © IBM Corp. |
| `kanit`                | Kanit                      | © Cadson Demak |
| `noto-sans-thai`       | Noto Sans Thai             | © Google LLC |
| `sarabun`              | Sarabun                    | © Cadson Demak |

Each ships a 400 (regular) and 700 (bold) weight. Regenerate with
`scripts` + `pyftsubset --flavor=woff2` if you change the character set.
