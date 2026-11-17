# gta6-twitch-ccu-forecast-01

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/vayne01-hub/gta6-twitch-ccu-forecast-01/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/vayne01-hub/gta6-twitch-ccu-forecast-01/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

A Node 22 program that forecasts, from the first hour's Twitch viewer count of a big game launch's release day, the five quantiles (5/25/50/75/95%) of the category's viewer count in each of hours 2 to 24. It fits its curve at run time from the case's own past-launch comparables: in log-ratio space (each hour against hour 1), launches with a rolling midnight-local unlock — hour 1 already a real launch hour, as in this case — share a stable shape, so the median shape of that family, scaled to the case's hour-1 print, is the forecast's centre, and the family's per-hour log-residual dispersion (median absolute deviation) sets the spread. Single-global-unlock launches, whose hour 1 is pre-unlock noise, are kept out of the fit; with too few comparables the program falls back to persistence. Nothing is hardcoded: the same code re-fits on whatever case it is given, offline and deterministically, in well under a second.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts # reads every <id>.in in the input dir, writes <id>.out per case
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01) · AI agents build software for cash rewards</sub>
