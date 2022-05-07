import dotenv from "dotenv";
dotenv.config();
import fs from "fs";
import path from "path";
import signale from "signale";
import { ethers, utils, providers, BigNumber } from "ethers";

const MINTING_CONTRACT = utils.getAddress(
  "0x49a19aA2a4E3fC19614d7aFCE014C60397A197Ac"
);
const TOKEN_CONTRACT = utils.getAddress(
  "0x5719DAcA15f885d49bF98ea2a9d03C5d97528d44"
);
const MINT_TOPIC =
  "0xdd06b66c3ba8126086cd863137d6f3b86ce5bcf4309cac390cc265e39194d0b2";
const TRANSFER_TOPIC =
  "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";
const OPENSEA_PURCHASE_TOPIC =
  "0xc4109843e0b7d514e4c093114b863f8e7d8d9a458c372cd51bfe526b588006c9";
const MINT_PRICE = 0.08;

const etherscanProvider = new providers.EtherscanProvider(
  "mainnet",
  process.env.ETHERSCAN_API_KEY
);

const jsonRpcProvider = new providers.JsonRpcProvider(
  process.env.HTTP_PROVIDER
);

const mintCount: Record<string, number> = {};

(async () => {
  Promise.all([await parseMinters(), await parseTokenTransfers()]);
})();

async function parseTokenTransfers() {
  signale.info("Getting token event log from Etherscan...");

  const eventLog = await etherscanProvider.getLogs({
    address: TOKEN_CONTRACT,
    fromBlock: 0,
    topics: [TRANSFER_TOPIC],
  });

  signale.success("Got token event log, parsing...");

  for (const event of eventLog) {
    const transaction = await jsonRpcProvider.getTransaction(
      event.transactionHash
    );

    // exclude initial dev mints
    if (
      utils.getAddress(transaction.from) ===
      utils.getAddress("0xf557597fed3f7fbfb2d4cc7ce304e2e4b7927053")
    )
      continue;

    const { logs } = await transaction.wait();

    const fromAddress = utils.getAddress(
      utils.defaultAbiCoder.decode(["address"], logs[0].topics[2])[0]
    );
    const toAddress = utils.getAddress(
      utils.defaultAbiCoder.decode(["address"], logs[0].topics[3])[0]
    );

    // exclude minting transfers
    if (fromAddress === MINTING_CONTRACT) continue;

    const [id, amount] = utils.defaultAbiCoder.decode(
      ["uint256", "uint256"],
      logs[0].data
    );

    // update to take into consideration transfers

    const parsedAmount = parseFloat(amount);

    mintCount[fromAddress] -= parsedAmount; // remove transferred token from balance

    // exclude opensea purchasers
    if (logs[1] && logs[1].topics[0] === OPENSEA_PURCHASE_TOPIC) continue;

    if (mintCount[toAddress]) {
      mintCount[toAddress] += parsedAmount;
    } else {
      mintCount[toAddress] = parsedAmount;
    }
  }

  // get refund values

  Object.keys(mintCount).map(
    (key) => (mintCount[key] = Number((mintCount[key] * 0.08).toFixed(2)))
  );

  fs.writeFileSync(
    path.join(__dirname, "../minterRefundValues.json"),
    JSON.stringify(mintCount)
  );

  const disperseValues = Object.keys(mintCount).map(
    (key) => `${key} ${mintCount[key]}`
  );

  fs.writeFileSync(
    path.join(__dirname, "../mintersDisperse.txt"),
    disperseValues.join("\n")
  );

  signale.success("Successfully created refund & disperse snapshot.");
}

async function parseMinters() {
  signale.info("Getting minting event log from Etherscan...");

  const eventLog = await etherscanProvider.getLogs({
    address: MINTING_CONTRACT,
    fromBlock: 0,
    topics: [MINT_TOPIC],
  });

  signale.success("Got minting event log, parsing...");

  for (const event of eventLog) {
    const transaction = await jsonRpcProvider.getTransaction(
      event.transactionHash
    );

    const from = utils.getAddress(transaction.from);

    const totalMinted =
      Number(utils.formatEther(transaction.value)) / MINT_PRICE;

    if (mintCount[from]) {
      mintCount[from] += totalMinted;
    } else {
      mintCount[from] = totalMinted;
    }
  }

  fs.writeFileSync(
    path.join(__dirname, "../minters.json"),
    JSON.stringify(mintCount)
  );

  signale.success("Successfully created total minted by address snapshot.");
}
