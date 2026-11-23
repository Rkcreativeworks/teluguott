# Telugu OTT Releases

A free static website that lists Telugu movies, web series and Telugu dubs, with the OTT platform for each. It has a weekly view and a month-wise view. A GitHub Action re-checks everything every day.

## Files

- `index.html` is the whole website.
- `data.json` is what the website shows. The daily job rewrites it.
- `manual.json` is your hand-checked list (dubs, small platforms, corrections).
- `candidates.json` is a daily review list of new Tamil, Malayalam, Kannada and Hindi films that might have a Telugu dub.
- `scripts/update.mjs` does the fetching and checking.
- `.github/workflows/update.yml` runs the script every day at 7:00 AM IST.

## What "Verified" means

The site shows only verified titles by default. A title is verified in one of two ways:

1. **Streaming now.** TMDB (with JustWatch data) lists the title as a subscription stream on that platform in India. Rent and buy options do not count. Titles that have not come out yet never qualify.
2. **Platform page checked by you.** You add the title's page on the platform itself (`proof`) and the date you looked (`checked`) in `manual.json`. The link must be on a known platform domain such as netflix.com, primevideo.com, hotstar.com, zee5.com, sonyliv.com, aha.video, sunnxt.com or etvwin.com, or it is ignored.

Everything else is "unverified". It stays hidden unless a visitor ticks "Also show unverified titles", and it is labelled clearly. Every card has a Source link so visitors can check for themselves.

## Covers and platform logos

Covers and platform logos come from TMDB and load from TMDB's image servers, so nothing is stored in your repo. The daily job saves each title's cover and the list of platform logos into `data.json`. A title with no cover shows a tile with its first letter. A platform with no logo shows its name only. Small services such as ETV Win or Sun NXT may have no logo in TMDB. For a Telugu dub, the cover is used only when TMDB has a film with the same name, year and original language, so you never get the wrong poster. Titles you add by hand get a cover the same way, whenever TMDB finds a match.

## Verified and Unverified tabs

The page has two tabs. **Verified** is the default. **Unverified** holds titles that come from news roundups only, with a warning above them. Both tabs work with the weekly view, the month view, the search and the filters.

## Telugu dubs

No free data source says which audio languages a platform offers, so a dub can only be verified by looking at the platform's own page. The workflow:

1. Open `candidates.json` after the daily run. It lists new non-Telugu films on streaming, with a link for each.
2. For a title you care about, open it on the platform and check that Telugu is in the audio list.
3. Add it to `manual.json`:

```json
{"n":"Sigma","t":"Movie","p":["Netflix"],"d":"2026-10-30","dub":"Tamil",
 "proof":"https://www.netflix.com/title/XXXXXXXX","checked":"2026-11-22"}
```

It shows up as a verified Telugu dub at the next run. Dubs in `manual.json` without `proof` stay unverified. The current list has several of these, taken from news roundups.

## Set up (about 10 minutes, free)

1. **Get a TMDB key.** Create a free account at themoviedb.org, then open Settings > API and copy the **API Read Access Token** (the long one).
2. **Create a GitHub repository.** Make a new public repo and upload all files from this folder, including the `.github` folder.
3. **Add the key.** In the repo go to Settings > Secrets and variables > Actions > New repository secret. Name it `TMDB_TOKEN` and paste the token.
4. **Turn on hosting.** Go to Settings > Pages. Under Source choose "Deploy from a branch", pick `main` and `/ (root)`, then save. Your site appears at `https://YOUR-NAME.github.io/REPO-NAME/`.
5. **Run the first check, with history.** Go to Actions > "Refresh Telugu OTT data" > Run workflow. Type `2023-01-01` in the **since** box and run it. It goes month by month from January 2023 to today, which takes roughly 10 to 20 minutes. After that it updates itself every day and re-checks only the last 45 days.

Until step 5 finishes, the site shows 0 verified titles, because nothing has been checked yet. If the run stops partway, run it again. It is safe to repeat.

## Older titles (2023 to 2025)

Verified for an older title means it is streaming on that platform in India today, not that it was on it in the past. A film that has since left a platform, or moved to rent only, will not appear as verified. The date shown is TMDB's Indian digital release date. Films with no such date in TMDB are skipped, not guessed. Open the Actions run log to see how many titles each month produced, and add anything missing by hand in `manual.json`.

## Limits to know

- JustWatch's list of Indian platforms can be missing small services such as ETV Win or Sun NXT, or lag a few days. Titles on those stay unverified until they appear there, unless you add a `proof` link.
- Dates for titles you add by hand are as reported by the source you list. Only the platform is checked.
- Opening `index.html` directly from your computer will not load the data. Use GitHub Pages, or run `python3 -m http.server` in this folder and open `localhost:8000`.
- TMDB asks for the attribution line that is already in the page footer. Keep it.
