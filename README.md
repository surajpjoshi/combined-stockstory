# Nifty Sector Relative Strength

Initial GitHub Actions + Python + Upstox setup.

## Current scope

- Fetch historical daily data from Upstox
- Test Nifty 50 data connection
- Keep Upstox token in GitHub Actions Secrets
- Prepare stock master CSV

## GitHub Secret

Create this repository secret:

`UPSTOX_ACCESS_TOKEN`

Do not put the actual token in the repository.

## Run

GitHub → Actions → Test Upstox Data → Run workflow

The next stage will calculate:

- Daily return
- Weekly return
- 1M return
- 3M return
- 6M return
- YTD return
- Nifty 3M return
- Stock RS vs Nifty
