import { koios } from "./koios";
import {
  applyParamsToScript,
  Constr,
  Data,
  fromText,
  keyHashToCredential,
  Lovelace,
  mintingPolicyToId,
  toUnit,
  TxSignBuilder,
  UTxO,
  Validator,
  validatorToAddress,
} from "@lucid-evolution/lucid";
import { network } from "@/config/lucid";
import { script } from "@/config/script";
import { STATE_TOKEN } from "@/config/crowdfunding";
import { WalletConnection } from "./contexts/wallet/WalletContext";
import { CampaignDatum, CampaignState } from "@/types/crowdfunding";
import { handleSuccess } from "./utils";
import { CampaignUTxO } from "./contexts/campaign/CampaignContext";

async function submitTx(tx: TxSignBuilder) {
  const txSigned = await tx.sign.withWallet().complete();
  const txHash = await txSigned.submit();

  return txHash;
}

function getShortestUTxO(utxos: UTxO[]) {
  const bigint2str = (_: any, val: { toString: () => any }) => (typeof val === "bigint" ? val.toString() : val);

  let shortestUTxO = JSON.stringify(utxos[0], bigint2str).length;
  let utxo = utxos[0];
  for (let u = 1; u < utxos.length; u++) {
    const currLen = JSON.stringify(utxos[u], bigint2str).length;
    if (currLen < shortestUTxO) {
      shortestUTxO = currLen;
      utxo = utxos[u];
    }
  }

  return utxo;
}

export async function createCampaign(
  { lucid, address, pkh, stakeAddress, skh }: WalletConnection,
  campaign: { name: string; goal: Lovelace; deadline: bigint }
): Promise<CampaignUTxO> {
  if (!lucid) throw "Unitialized Lucid";

  const crowdfundingPlatform = localStorage.getItem("CrowdfundingPlatform");
  if (!crowdfundingPlatform) throw "Go to Admin page to set the Crowdfunding Platform Address first!";

  const platform = JSON.parse(crowdfundingPlatform); // Platform { address, pkh, stakeAddress, skh }
  const creator = { address, pkh, stakeAddress, skh };
  if (!creator.address && !creator.pkh && creator.stakeAddress && !creator.skh) throw "Unconnected Wallet";

  const utxos = await lucid.wallet().getUtxos();
  if (!utxos || !utxos.length) throw "Empty Wallet";

  const nonceUTxO = getShortestUTxO(utxos);
  const nonceTxHash = String(nonceUTxO.txHash);
  const nonceTxIdx = BigInt(nonceUTxO.outputIndex);
  const nonceORef = new Constr(0, [nonceTxHash, nonceTxIdx]);

  const campaignValidator: Validator = {
    type: "PlutusV3",
    script: applyParamsToScript(script.Crowdfunding, [platform.pkh ?? "", creator.pkh ?? "", nonceORef]),
  };
  const campaignPolicy = mintingPolicyToId(campaignValidator);
  const campaignAddress = validatorToAddress(network, campaignValidator);

  const StateTokenUnit = toUnit(campaignPolicy, STATE_TOKEN.hex); // `${PolicyID}${AssetName}`
  const StateToken = { [StateTokenUnit]: 1n };
  console.log(StateToken);

  //#region Temp CBOR Serialize/Deserializing
  const campaignDatum: CampaignDatum = {
    name: fromText(campaign.name),
    goal: campaign.goal,
    deadline: campaign.deadline,
    creator: [creator.pkh ?? "", creator.skh ?? ""],
    state: "Running",
  };
  const campaignDatumRedeemer = Data.to(campaignDatum, CampaignDatum);

  // Serializing to CBOR
  const creatorAddress = [creator.pkh ?? "", creator.skh ?? ""];
  const campaignState = CampaignState.Running.Constr;
  const campaignDatumFromConstr = new Constr(0, [fromText(campaign.name), BigInt(campaign.goal), BigInt(campaign.deadline), creatorAddress, campaignState]);
  const mintRedeemer = Data.to(campaignDatumFromConstr);
  console.log(mintRedeemer);

  // Deserializing from CBOR
  const datum = Data.from(mintRedeemer, CampaignDatum);
  console.log(datum);

  console.log(campaignDatumRedeemer === mintRedeemer);
  //#endregion

  const now = await koios.getBlockTimeMs();

  const tx = await lucid
    .newTx()
    .collectFrom([nonceUTxO])
    .mintAssets(StateToken, mintRedeemer)
    .attachMetadata(721, {
      [campaignPolicy]: {
        [STATE_TOKEN.assetName]: {
          platform: platform.pkh ?? "",
          creator: creator.pkh ?? "",
          hash: nonceUTxO.txHash,
          index: nonceUTxO.outputIndex,
        },
      },
    })
    .attach.MintingPolicy(campaignValidator)
    .pay.ToContract(campaignAddress, { kind: "inline", value: mintRedeemer }, StateToken)
    .validFrom(now)
    .complete({ localUPLCEval: false });

  const txHash = await submitTx(tx);
  handleSuccess(`Create Campaign TxHash: ${txHash}`);

  return {
    CampaignInfo: {
      id: campaignPolicy,
      platform: { pkh: platform.pkh },
      nonce: { txHash: nonceUTxO.txHash, outputIndex: nonceUTxO.outputIndex },
      validator: campaignValidator,
      address: campaignAddress,
      datum: campaignDatum,
      data: {
        name: campaign.name,
        goal: parseFloat(`${campaign.goal / 1_000000n}.${campaign.goal % 1_000000n}`),
        deadline: new Date(parseInt(campaign.deadline.toString())),
        creator: { pk: keyHashToCredential(creator.pkh ?? ""), sk: keyHashToCredential(creator.skh ?? ""), address: creator.address ?? "" },
        state: "Running",
      },
    },
    StateToken: {
      unit: StateTokenUnit,
      utxo: {
        txHash,
        outputIndex: 0,
        address: campaignAddress,
        assets: StateToken,
        datum: mintRedeemer,
      },
    },
  };
}