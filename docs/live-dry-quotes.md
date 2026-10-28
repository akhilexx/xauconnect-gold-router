# Live dry quotes, 28 Oct 2026 (~22:40 IST)

These are real 1Click quotes from `https://1click.chaindefuser.com`. All of them are dry (`dry: true`): no deposit address was requested and nothing was sent. The addresses are public placeholders: `<EVM>` is a well-known public EVM address and `<SOL>` is a public Solana address. They were used only as quote recipient and refund fields. The quotes ran without a JWT, so they include 1Click's 0.2% no-key fee. Prices are live and will differ on a rerun.

```
$ node src/cli.ts fund --mint HXXMuNxDShXhK6QGd4CczTgSiXr1YqNbUdpg9rTbWj5r --pool-config ExTrSGZBjzMrueBNHEALCCJmppB9zpoTSWJea4iR2gQu --wallet <SOL> --from-chain arbitrum --token-in 0xaf88d065e77c8cc2239327c5edb3a432268e5831 --sender <EVM> --want 0.5 --raised 9.8
Fund from another chain: fair-sol (quote SOL), dry quote, nothing sent
  XAU Route: send 51.114348 from arbitrum (~$51.08) -> 0.5 SOL on Solana (min 500000000 base units), cost 112 bps, ~22s
  graduation: 0.2 SOL left, this covers 100.0%
  WARNING: Only 0.2 SOL is left before this pool graduates. Anything above that may not fill on the curve.
  next: finish the buy on the existing token page with your Solana wallet: https://xauconnect.com/token/solana/HXXMuNxDShXhK6QGd4CczTgSiXr1YqNbUdpg9rTbWj5r

$ node src/cli.ts fund --mint HXXMuNxDShXhK6QGd4CczTgSiXr1YqNbUdpg9rTbWj5r --recipe fair-usdc --wallet <SOL> --from-chain base --token-in native --sender <EVM> --spend 10000000000000000
Fund from another chain: fair-usdc (quote USDC), dry quote, nothing sent
  XAU Route: send 0.01 from base (~$23.31) -> 23.241698 USDC on Solana (min 23009281 base units), cost 36 bps, ~32s
  next: finish the buy on the existing token page with your Solana wallet: https://xauconnect.com/token/solana/HXXMuNxDShXhK6QGd4CczTgSiXr1YqNbUdpg9rTbWj5r

$ node src/cli.ts fund --mint HXXMuNxDShXhK6QGd4CczTgSiXr1YqNbUdpg9rTbWj5r --recipe shield-sol --wallet <SOL> --from-chain polygon --token-in 0x3c499c542cef5e3811e1192ce70d8cc03d5c3359 --sender <EVM> --spend 20000000
Fund from another chain: shield-sol (quote SOL), dry quote, nothing sent
  XAU Route: send 20.0 from polygon (~$19.99) -> 0.197512645 SOL on Solana (min 195537518 base units), cost 17 bps, ~32s
  next: finish the buy on the existing token page with your Solana wallet: https://xauconnect.com/token/solana/HXXMuNxDShXhK6QGd4CczTgSiXr1YqNbUdpg9rTbWj5r

$ node src/cli.ts fund --mint HXXMuNxDShXhK6QGd4CczTgSiXr1YqNbUdpg9rTbWj5r --recipe distribute-sol --wallet <SOL> --from-chain avalanche --token-in 0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e --sender <EVM> --want 0.1
Fund from another chain: distribute-sol (quote SOL), dry quote, nothing sent
  XAU Route: send 10.234322 from avalanche (~$10.23) -> 0.1 SOL on Solana (min 100000000 base units), cost 123 bps, ~32s
  next: finish the buy on the existing token page with your Solana wallet: https://xauconnect.com/token/solana/HXXMuNxDShXhK6QGd4CczTgSiXr1YqNbUdpg9rTbWj5r

$ node src/cli.ts fund --mint HXXMuNxDShXhK6QGd4CczTgSiXr1YqNbUdpg9rTbWj5r --recipe fair-sol --wallet <SOL> --from-chain bsc --token-in 0x55d398326f99059ff775485246999027b3197955 --sender <EVM> --spend 5
no route: Amount is too small for a cross-chain XAU Route. Try a larger amount. (1Click 400: Temporary swap limits: minimum swap amount is $1,000)

$ POST /v1/xau/cross-chain/quote solana USDC -> XAUT on ethereum (25 USDC)
quoteRef 15d32d52… XAU Route: 25.0 USDC@sol ($24.9862) -> 0.00611 XAUT@eth ($24.6560496), cost 132 bps, ~29s, request.dry=true
$ POST /v1/routes/<id>/execute without EXECUTION_ENABLED (live server)
no confirm -> HTTP 403
{
  "error": "execution is off (set EXECUTION_ENABLED=1 to allow deposit addresses)",
  "code": "EXECUTION_DISABLED"
} -> HTTP 403
```

Notes:
- The BSC USDT leg was refused upstream with 'Temporary swap limits: minimum swap amount is $1,000'. The venue maps this to the AMOUNT_TOO_LOW user message, which doesn't name the venue.
- The execute call on the live server returned 403 both without confirm and with confirm. EXECUTION_ENABLED was not set, so no dry:false request was made.
