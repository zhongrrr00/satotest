(function () {
  "use strict";

  const ADDRESSES = {
    poolManager: "0x63d6850602abfefa435d18d1e2a733a186387bb6",
    token: "0x28d14bb7a753f7799140e9790080b53f6e861eea",
    hook: "0xf915EF9B93002bcB6fe55298429AF6EeBD5BE888",
    router: "0x22daCAD3c40434cD08eA3AEb922bF4fA910677EF"
  };

  const CHAIN_ID = 97n;
  const CHAIN_ID_HEX = "0x61";
  const RPC_URL = "https://data-seed-prebsc-1-s1.binance.org:8545";
  const TOKEN_DECIMALS = 18;
  const K = 21_000_000;
  const S = 500;
  const FEE = 0.003;
  const DEMO_NATIVE_USD = 1615;

  const ROUTER_ABI = [
    "function buy(uint256 minSatoOut) payable returns (uint256 satoOut)",
    "function sell(uint256 satoIn, uint256 minBnbOut) returns (uint256 bnbOut)"
  ];
  const TOKEN_ABI = [
    "function balanceOf(address account) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 value) returns (bool)",
    "function totalSupply() view returns (uint256)"
  ];
  const HOOK_ABI = [
    "function ethCum() view returns (uint256)",
    "function totalMintedFair() view returns (uint256)",
    "function feesAccrued() view returns (uint256)",
    "function curveReserveEth() view returns (uint256)",
    "function selfDeprecated() view returns (bool)"
  ];

  const el = {
    connectBtn: document.getElementById("connectBtn"),
    mintTab: document.getElementById("mintTab"),
    burnTab: document.getElementById("burnTab"),
    amountInput: document.getElementById("amountInput"),
    maxBtn: document.getElementById("maxBtn"),
    tradeBtn: document.getElementById("tradeBtn"),
    inputLabel: document.getElementById("inputLabel"),
    balanceLabel: document.getElementById("balanceLabel"),
    unitLabel: document.getElementById("unitLabel"),
    limitLine: document.getElementById("limitLine"),
    quoteVerb: document.getElementById("quoteVerb"),
    quoteOut: document.getElementById("quoteOut"),
    quoteIn: document.getElementById("quoteIn"),
    impactText: document.getElementById("impactText"),
    tradeHint: document.getElementById("tradeHint"),
    routerAddress: document.getElementById("routerAddress"),
    networkPill: document.getElementById("networkPill")
  };

  const ids = [
    "tickerPrice",
    "tickerBurn",
    "tickerMint",
    "tickerReserve",
    "tickerReserveEth",
    "tickerCirc",
    "chartSupply",
    "chartPrice",
    "chartBurn",
    "chartMint",
    "dataMax",
    "dataCirc",
    "dataPrice",
    "dataBurn",
    "dataMint",
    "dataFdv",
    "dataMcap",
    "dataReserve",
    "dataBacking",
    "dataFees",
    "satoRateNow"
  ].reduce((acc, id) => {
    acc[id] = document.getElementById(id);
    return acc;
  }, {});

  const state = {
    mode: "mint",
    account: null,
    provider: null,
    signer: null,
    router: null,
    token: null,
    hook: null,
    busy: false,
    live: false,
    balances: {
      bnb: 0,
      sato: 0,
      allowance: 0
    },
    stats: {
      ethCum: 1600,
      totalMintedFair: 19_300_000,
      actualSupply: 19_370_000,
      reserveEth: 1663.1583,
      feesAccrued: 97.0714,
      selfDeprecated: false
    }
  };

  function short(addr) {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function totalMinted(eth) {
    if (eth <= 0) return 0;
    return K * (1 - Math.exp(-eth / S));
  }

  function mintFor(ethBefore, ethIn) {
    if (ethIn <= 0) return 0;
    return Math.max(0, totalMinted(ethBefore + ethIn) - totalMinted(ethBefore));
  }

  function burnFor(currentTotal, satoIn) {
    if (satoIn <= 0 || currentTotal <= 0) return 0;
    const denom = Math.max(1e-9, K - currentTotal);
    const fairIn = Math.min(satoIn, currentTotal);
    return S * Math.log((denom + fairIn) / denom);
  }

  function marginalNativePrice(eth) {
    return (S * Math.exp(eth / S)) / K;
  }

  function mintRate(eth) {
    return Math.max(0, K / S * Math.exp(-eth / S));
  }

  function fmtCompact(n, digits = 2) {
    if (!Number.isFinite(n)) return "--";
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(digits)}m`;
    if (abs >= 1_000) return `${(n / 1_000).toFixed(digits)}k`;
    return n.toFixed(digits);
  }

  function fmtMoney(n, digits = 2) {
    if (!Number.isFinite(n)) return "$--";
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(digits)}m`;
    if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(digits)}k`;
    if (Math.abs(n) < 0.01) return `$${n.toFixed(6)}`;
    return `$${n.toFixed(digits)}`;
  }

  function fmtPlain(n, digits = 4) {
    if (!Number.isFinite(n)) return "--";
    return n.toLocaleString("en-US", {
      maximumFractionDigits: digits,
      minimumFractionDigits: 0
    });
  }

  function inputAmount() {
    const raw = el.amountInput.value.trim();
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function quote(amount = inputAmount()) {
    const stats = state.stats;
    if (state.mode === "mint") {
      const capped = Math.min(amount, 5);
      const ethToCurve = capped * (1 - FEE);
      const out = mintFor(stats.ethCum, ethToCurve);
      const before = marginalNativePrice(stats.ethCum);
      const after = marginalNativePrice(stats.ethCum + ethToCurve);
      const impact = before > 0 ? ((after - before) / before) * 100 : 0;
      return { inAmount: capped, outAmount: out, impact, nativeOut: 0 };
    }

    const actualSupply = Math.max(stats.actualSupply, 1);
    const fairIn = amount * (stats.totalMintedFair / actualSupply);
    const raw = burnFor(stats.totalMintedFair, fairIn);
    const out = raw * (1 - FEE);
    const before = marginalNativePrice(stats.ethCum);
    const afterEthCum = Math.max(0, stats.ethCum - raw);
    const after = marginalNativePrice(afterEthCum);
    const impact = before > 0 ? ((before - after) / before) * 100 : 0;
    return { inAmount: amount, outAmount: out, impact, nativeOut: out };
  }

  function displayStats() {
    const stats = state.stats;
    const nativeUsd = DEMO_NATIVE_USD;
    const price = marginalNativePrice(stats.ethCum) * nativeUsd;
    const mintPrice = marginalNativePrice(stats.ethCum + 1) * nativeUsd;
    const burnPrice = Math.max(0, price * (1 - FEE) * 0.75);
    const reserveUsd = stats.reserveEth * nativeUsd;
    const fdv = K * price;
    const mcap = stats.actualSupply * price;
    const backing = stats.actualSupply > 0 ? reserveUsd / stats.actualSupply : 0;

    ids.tickerPrice.textContent = fmtMoney(price, 4);
    ids.tickerBurn.textContent = fmtMoney(burnPrice, 4);
    ids.tickerMint.textContent = fmtMoney(mintPrice, 2);
    ids.tickerReserve.textContent = fmtMoney(reserveUsd, 2);
    ids.tickerReserveEth.textContent = `(${fmtPlain(stats.reserveEth, 4)} bnb)`;
    ids.tickerCirc.textContent = fmtCompact(stats.actualSupply, 2);
    ids.chartSupply.textContent = fmtCompact(stats.totalMintedFair, 1);
    ids.chartPrice.textContent = fmtMoney(price, 4);
    ids.chartBurn.textContent = fmtMoney(burnPrice, 4);
    ids.chartMint.textContent = fmtMoney(mintPrice, 2);
    ids.dataMax.textContent = fmtCompact(K * 0.99, 2);
    ids.dataCirc.textContent = fmtCompact(stats.actualSupply, 2);
    ids.dataPrice.textContent = fmtMoney(price, 4);
    ids.dataBurn.textContent = fmtMoney(burnPrice, 4);
    ids.dataMint.textContent = fmtMoney(mintPrice, 2);
    ids.dataFdv.textContent = fmtMoney(fdv, 2);
    ids.dataMcap.textContent = fmtMoney(mcap, 2);
    ids.dataReserve.textContent = fmtMoney(reserveUsd, 2);
    ids.dataBacking.textContent = fmtMoney(backing, 3);
    ids.dataFees.textContent = `${fmtPlain(stats.feesAccrued, 4)} bnb`;
    ids.satoRateNow.textContent = `${fmtCompact(mintRate(stats.ethCum), 0)} sato/bnb`;

    el.networkPill.textContent = state.live ? "bsc testnet live" : "bsc testnet demo";
    updateQuote();
    drawAll();
  }

  function updateQuote() {
    const amount = inputAmount();
    const q = quote(amount);
    const ready = amount > 0 && state.account && !state.busy && !state.stats.selfDeprecated;

    if (state.mode === "mint") {
      el.inputLabel.textContent = "pay";
      el.unitLabel.textContent = "bnb";
      el.limitLine.textContent = "max mint 5 BNB";
      el.quoteVerb.textContent = "minting";
      el.quoteVerb.className = "green";
      el.quoteOut.textContent = `${fmtPlain(q.outAmount, q.outAmount > 100 ? 2 : 6)} sato`;
      el.quoteIn.textContent = `${fmtPlain(q.inAmount, 4)} bnb`;
      el.tradeBtn.textContent = state.busy ? "waiting..." : "mint sato";
      el.balanceLabel.textContent = `bal: ${fmtPlain(state.balances.bnb, 4)}`;
    } else {
      const weiNeeded = amount;
      const needsApproval = state.account && weiNeeded > state.balances.allowance + 1e-12;
      el.inputLabel.textContent = "sell";
      el.unitLabel.textContent = "sato";
      el.limitLine.textContent = "burns through inverse curve";
      el.quoteVerb.textContent = "burning";
      el.quoteVerb.className = "red";
      el.quoteOut.textContent = `${fmtPlain(q.outAmount, 6)} bnb`;
      el.quoteIn.textContent = `${fmtPlain(q.inAmount, 4)} sato`;
      el.tradeBtn.textContent = state.busy ? "waiting..." : needsApproval ? "approve sato" : "burn sato";
      el.balanceLabel.textContent = `bal: ${fmtPlain(state.balances.sato, 2)}`;
    }

    el.impactText.textContent = `${fmtPlain(q.impact, 2)}%`;
    el.tradeBtn.disabled = !ready;
    el.tradeBtn.classList.toggle("ready", ready);
    el.tradeBtn.classList.toggle("wait", state.busy);
  }

  function setMode(mode) {
    state.mode = mode;
    el.mintTab.classList.toggle("active", mode === "mint");
    el.burnTab.classList.toggle("active", mode === "burn");
    el.amountInput.value = "";
    updateQuote();
  }

  async function switchToBscTestnet() {
    if (!window.ethereum) throw new Error("wallet not found");
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_ID_HEX }]
      });
    } catch (err) {
      if (err && err.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: CHAIN_ID_HEX,
              chainName: "BSC Testnet",
              nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
              rpcUrls: [RPC_URL],
              blockExplorerUrls: ["https://testnet.bscscan.com"]
            }
          ]
        });
      } else {
        throw err;
      }
    }
  }

  async function connect() {
    if (!window.ethers || !window.ethereum) {
      el.tradeHint.textContent = "install a browser wallet to call the test router";
      return;
    }

    state.provider = new window.ethers.BrowserProvider(window.ethereum);
    await state.provider.send("eth_requestAccounts", []);
    const network = await state.provider.getNetwork();
    if (network.chainId !== CHAIN_ID) {
      await switchToBscTestnet();
      state.provider = new window.ethers.BrowserProvider(window.ethereum);
    }

    state.signer = await state.provider.getSigner();
    state.account = await state.signer.getAddress();
    state.router = new window.ethers.Contract(ADDRESSES.router, ROUTER_ABI, state.signer);
    state.token = new window.ethers.Contract(ADDRESSES.token, TOKEN_ABI, state.signer);
    state.hook = new window.ethers.Contract(ADDRESSES.hook, HOOK_ABI, state.provider);
    el.connectBtn.textContent = short(state.account);
    await refreshLiveData();
  }

  async function hydrateFromRpc() {
    if (!window.ethers) return;
    try {
      const provider = new window.ethers.JsonRpcProvider(RPC_URL);
      const hook = new window.ethers.Contract(ADDRESSES.hook, HOOK_ABI, provider);
      const token = new window.ethers.Contract(ADDRESSES.token, TOKEN_ABI, provider);
      const [ethCum, fair, supply, reserve, fees, deprecated] = await Promise.all([
        hook.ethCum(),
        hook.totalMintedFair(),
        token.totalSupply(),
        hook.curveReserveEth(),
        hook.feesAccrued(),
        hook.selfDeprecated()
      ]);
      state.stats.ethCum = Number(window.ethers.formatEther(ethCum));
      state.stats.totalMintedFair = Number(window.ethers.formatEther(fair));
      state.stats.actualSupply = Number(window.ethers.formatEther(supply));
      state.stats.reserveEth = Number(window.ethers.formatEther(reserve));
      state.stats.feesAccrued = Number(window.ethers.formatEther(fees));
      state.stats.selfDeprecated = Boolean(deprecated);
      state.live = true;
      displayStats();
    } catch (_) {
      state.live = false;
      displayStats();
    }
  }

  async function refreshLiveData() {
    if (!state.provider || !state.account || !state.hook || !state.token) return;
    try {
      const [bnb, sato, allowance, ethCum, fair, supply, reserve, fees, deprecated] = await Promise.all([
        state.provider.getBalance(state.account),
        state.token.balanceOf(state.account),
        state.token.allowance(state.account, ADDRESSES.router),
        state.hook.ethCum(),
        state.hook.totalMintedFair(),
        state.token.totalSupply(),
        state.hook.curveReserveEth(),
        state.hook.feesAccrued(),
        state.hook.selfDeprecated()
      ]);
      state.balances.bnb = Number(window.ethers.formatEther(bnb));
      state.balances.sato = Number(window.ethers.formatUnits(sato, TOKEN_DECIMALS));
      state.balances.allowance = Number(window.ethers.formatUnits(allowance, TOKEN_DECIMALS));
      state.stats.ethCum = Number(window.ethers.formatEther(ethCum));
      state.stats.totalMintedFair = Number(window.ethers.formatEther(fair));
      state.stats.actualSupply = Number(window.ethers.formatUnits(supply, TOKEN_DECIMALS));
      state.stats.reserveEth = Number(window.ethers.formatEther(reserve));
      state.stats.feesAccrued = Number(window.ethers.formatEther(fees));
      state.stats.selfDeprecated = Boolean(deprecated);
      state.live = true;
      displayStats();
    } catch (err) {
      el.tradeHint.textContent = err.shortMessage || err.message || "could not refresh chain data";
      updateQuote();
    }
  }

  async function submitTrade() {
    const amount = inputAmount();
    if (!amount || !state.router || !state.token || state.busy) return;
    state.busy = true;
    updateQuote();

    try {
      if (state.mode === "mint") {
        const value = window.ethers.parseEther(String(Math.min(amount, 5)));
        const tx = await state.router.buy(0, { value });
        el.tradeHint.textContent = `mint tx sent ${short(tx.hash)}`;
        await tx.wait();
      } else {
        const satoIn = window.ethers.parseUnits(String(amount), TOKEN_DECIMALS);
        const currentAllowance = window.ethers.parseUnits(String(state.balances.allowance || 0), TOKEN_DECIMALS);
        if (currentAllowance < satoIn) {
          const tx = await state.token.approve(ADDRESSES.router, satoIn);
          el.tradeHint.textContent = `approve tx sent ${short(tx.hash)}`;
          await tx.wait();
        } else {
          const tx = await state.router.sell(satoIn, 0);
          el.tradeHint.textContent = `burn tx sent ${short(tx.hash)}`;
          await tx.wait();
        }
      }
      el.amountInput.value = "";
      await refreshLiveData();
      el.tradeHint.innerHTML = `calls SatoTestRouter via BSC testnet PoolManager<br /><span>${short(ADDRESSES.router)}</span>`;
    } catch (err) {
      el.tradeHint.textContent = err.shortMessage || err.reason || err.message || "transaction failed";
    } finally {
      state.busy = false;
      updateQuote();
    }
  }

  function setupCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: rect.width, h: rect.height };
  }

  function poly(ctx, points, color, width = 2) {
    if (!points.length) return;
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function drawGrid(ctx, left, top, right, bottom) {
    ctx.strokeStyle = "#26262c";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    for (let i = 0; i <= 4; i += 1) {
      const y = top + ((bottom - top) * i) / 4;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = "#34343b";
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left, bottom);
    ctx.lineTo(right, bottom);
    ctx.stroke();
  }

  function drawCurve() {
    const canvas = document.getElementById("curveCanvas");
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);

    const left = 64;
    const right = w - 70;
    const top = 28;
    const bottom = h - 36;
    const maxEth = 3000;
    const maxPrice = marginalNativePrice(maxEth) * DEMO_NATIVE_USD;
    const current = clamp(state.stats.ethCum, 0, maxEth);

    const x = (eth) => left + (eth / maxEth) * (right - left);
    const ySupply = (supply) => bottom - (supply / K) * (bottom - top);
    const yPrice = (price) => bottom - (price / maxPrice) * (bottom - top);

    drawGrid(ctx, left, top, right, bottom);
    ctx.font = "12px ui-monospace, monospace";
    ctx.fillStyle = "#10d8a6";
    [0, 5, 10, 15, 20, 21].forEach((m) => {
      const y = ySupply(m * 1_000_000);
      ctx.fillText(m === 0 ? "0" : `${m}m`, left - 34, y + 4);
    });
    ctx.fillStyle = "#f5c518";
    [0, 5.56, 11.11, 16.67].forEach((p) => {
      const labelY = clamp(yPrice(p) + 4, top + 12, bottom);
      ctx.fillText(p === 0 ? "$0" : `$${p.toFixed(2)}`, right + 8, labelY);
    });
    ctx.fillStyle = "#777782";
    [0, 500, 1000, 1500, 2000, 2500].forEach((tick) => {
      ctx.fillText(String(tick), x(tick) - 8, bottom + 18);
    });
    ctx.fillText("cumulative bnb", (left + right) / 2 - 58, bottom + 34);

    const supplyPts = [];
    const pricePts = [];
    for (let i = 0; i <= 160; i += 1) {
      const eth = (maxEth * i) / 160;
      supplyPts.push({ eth, x: x(eth), y: ySupply(totalMinted(eth)) });
      pricePts.push({ x: x(eth), y: yPrice(marginalNativePrice(eth) * DEMO_NATIVE_USD) });
    }

    ctx.beginPath();
    ctx.moveTo(left, bottom);
    supplyPts.filter((p) => p.eth <= current).forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.lineTo(x(current), bottom);
    ctx.closePath();
    ctx.fillStyle = "rgba(16,216,166,0.10)";
    ctx.fill();

    poly(ctx, supplyPts, "#10d8a6", 2);
    poly(ctx, pricePts, "#f5c518", 2);

    const cx = x(current);
    const cy = ySupply(totalMinted(current));
    ctx.setLineDash([2, 5]);
    ctx.strokeStyle = "rgba(16,216,166,0.55)";
    ctx.beginPath();
    ctx.moveTo(cx, top);
    ctx.lineTo(cx, bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#09090b";
    ctx.strokeStyle = "#10d8a6";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const q = quote();
    if (q.inAmount > 0 && state.mode === "mint") {
      const nx = x(clamp(current + q.inAmount * (1 - FEE), 0, maxEth));
      const ny = ySupply(totalMinted(current + q.inAmount * (1 - FEE)));
      ctx.fillStyle = "#f04aaa";
      ctx.beginPath();
      ctx.arc(nx, ny, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBtc() {
    const canvas = document.getElementById("btcCanvas");
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const left = 58;
    const right = w - 22;
    const top = 18;
    const bottom = h - 54;
    drawGrid(ctx, left, top, right, bottom);

    const years = [2009, 2012, 2016, 2020, 2024, 2028, 2032, 2036];
    const rewards = [50, 25, 12.5, 6.25, 3.125, 1.5625, 0.78, 0.39];
    const x = (i) => left + (i / (years.length - 1)) * (right - left);
    const y = (v) => bottom - (Math.log2(v + 1) / Math.log2(51)) * (bottom - top);

    ctx.fillStyle = "rgba(245,197,24,0.70)";
    rewards.forEach((r, i) => {
      const bh = bottom - y(r);
      const bw = (right - left) / years.length - 6;
      ctx.fillRect(x(i) - bw / 2, y(r), bw, bh);
      ctx.fillStyle = i === 4 ? "#f5c518" : "#8d8d98";
      ctx.fillText(String(r), x(i) - 16, y(r) - 5);
      ctx.fillStyle = "rgba(245,197,24,0.70)";
    });

    const points = years.map((_, i) => ({ x: x(i), y: y(21 - 21 / (i + 1.3)) }));
    poly(ctx, points, "#f5c518", 3);

    ctx.strokeStyle = "#f5c518";
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(x(4), top);
    ctx.lineTo(x(4), bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x(4), y(19.8), 7, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#8d8d98";
    ctx.font = "13px ui-monospace, monospace";
    ctx.fillText("21m", left - 42, top + 8);
    ctx.fillText("0", left - 22, bottom + 4);
    years.forEach((yr, i) => {
      ctx.fillStyle = i === 4 ? "#f5c518" : "#686872";
      ctx.fillText(String(yr), x(i) - 18, bottom + 18);
    });
    ctx.fillStyle = "#8d8d98";
    ctx.font = "18px ui-monospace, monospace";
    ctx.fillText("halving epochs - ~4y each", (left + right) / 2 - 112, h - 8);
  }

  function drawSatoIssue() {
    const canvas = document.getElementById("satoCanvas");
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const left = 58;
    const right = w - 22;
    const top = 18;
    const bottom = h - 54;
    const maxEth = 3000;
    drawGrid(ctx, left, top, right, bottom);
    const x = (eth) => left + (eth / maxEth) * (right - left);
    const y = (sup) => bottom - (sup / K) * (bottom - top);

    const bars = [29_000, 12_000, 6_000, 3_000, 1_000, 500, 321];
    ctx.fillStyle = "rgba(16,216,166,0.65)";
    bars.forEach((b, i) => {
      const bh = (b / 30_000) * (bottom - top) * 0.36;
      const bw = (right - left) / 8 - 6;
      const bx = left + i * ((right - left) / 8);
      ctx.fillRect(bx, bottom - bh, bw, bh);
      if (i === 0 || i === 2 || i === 4 || i === 6) {
        ctx.fillStyle = i === 4 ? "#10d8a6" : "#8d8d98";
        ctx.fillText(i === 0 ? "29k" : i === 2 ? "6k" : i === 4 ? "1k" : "321", bx + 10, bottom - bh - 5);
        ctx.fillStyle = "rgba(16,216,166,0.65)";
      }
    });

    const pts = [];
    for (let i = 0; i <= 100; i += 1) {
      const eth = (maxEth * i) / 100;
      pts.push({ x: x(eth), y: y(totalMinted(eth)) });
    }
    poly(ctx, pts, "#10d8a6", 3);

    const current = clamp(state.stats.ethCum, 0, maxEth);
    ctx.strokeStyle = "#10d8a6";
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(x(current), top);
    ctx.lineTo(x(current), bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x(current), y(totalMinted(current)), 7, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#8d8d98";
    ctx.font = "13px ui-monospace, monospace";
    ctx.fillText("21m", left - 42, top + 8);
    ctx.fillText("0", left - 22, bottom + 4);
    [0, 750, 1500, 2250].forEach((tick) => {
      ctx.fillStyle = Math.abs(tick - current) < 120 ? "#10d8a6" : "#686872";
      ctx.fillText(String(tick), x(tick) - 10, bottom + 18);
    });
    ctx.fillStyle = "#8d8d98";
    ctx.font = "18px ui-monospace, monospace";
    ctx.fillText("cumulative bnb (0 to inf)", (left + right) / 2 - 118, h - 8);
  }

  function drawFlow() {
    const canvas = document.getElementById("flowCanvas");
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const left = 12;
    const right = w - 12;
    const mid = h * 0.56;
    const values = [-2, 18, 9, -1, 3, 1, 36, 5, 2, 1, 3, 7, 0, 6, 2, 1, -1, 6, 40, 1, 7, 3, 1, 1];
    const max = Math.max(...values.map((v) => Math.abs(v)));
    const gap = 5;
    const bw = (right - left - gap * (values.length - 1)) / values.length;

    ctx.strokeStyle = "#34343b";
    ctx.beginPath();
    ctx.moveTo(left, mid);
    ctx.lineTo(right, mid);
    ctx.stroke();

    values.forEach((v, i) => {
      const x = left + i * (bw + gap);
      const bh = (Math.abs(v) / max) * (h * 0.48);
      ctx.fillStyle = v >= 0 ? "#10d8a6" : "#ff6868";
      if (v >= 0) ctx.fillRect(x, mid - bh, bw, bh);
      else ctx.fillRect(x, mid, bw, bh * 0.32);
    });
  }

  function drawAll() {
    drawCurve();
    drawBtc();
    drawSatoIssue();
    drawFlow();
  }

  function bind() {
    el.connectBtn.addEventListener("click", connect);
    el.mintTab.addEventListener("click", () => setMode("mint"));
    el.burnTab.addEventListener("click", () => setMode("burn"));
    el.amountInput.addEventListener("input", updateQuote);
    el.maxBtn.addEventListener("click", () => {
      const max = state.mode === "mint" ? Math.min(5, state.balances.bnb || 5) : state.balances.sato;
      el.amountInput.value = max ? String(Math.max(0, max).toFixed(state.mode === "mint" ? 4 : 2)) : "";
      updateQuote();
    });
    el.tradeBtn.addEventListener("click", submitTrade);
    window.addEventListener("resize", drawAll);

    if (window.ethereum) {
      window.ethereum.on("accountsChanged", () => connect().catch(() => {}));
      window.ethereum.on("chainChanged", () => window.location.reload());
    }
  }

  function init() {
    el.routerAddress.textContent = short(ADDRESSES.router);
    bind();
    displayStats();
    window.setTimeout(hydrateFromRpc, 200);
    window.setInterval(() => {
      if (state.account) refreshLiveData();
    }, 15000);
  }

  window.addEventListener("load", init);
})();
