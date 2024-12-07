import { useWallet } from "@/components/contexts/wallet/WalletContext";
import { useCampaign } from "@/components/contexts/campaign/CampaignContext";

import CampaignCard from "@/components/CampaignCard";
import ButtonCreateCampaign from "@/components/ButtonCreateCampaign";
import ButtonCancelCampaign from "@/components/ButtonCancelCampaign";
import ButtonFinishCampaign from "@/components/ButtonFinishCampaign";

export default function CreatorDashboard() {
  const [{ address }] = useWallet();
  const [campaign] = useCampaign();
  if (!campaign || campaign.CampaignInfo.data.creator.address !== address) return <ButtonCreateCampaign />;

  const { CampaignInfo } = campaign;
  return (
    <CampaignCard
      campaign={campaign}
      hasActions={CampaignInfo.data.state === "Running"}
      actionButtons={
        <>
          {CampaignInfo.data.support.ada < CampaignInfo.data.goal ? (
            // Goal not reached yet? Creator can cancel the campaign:
            <ButtonCancelCampaign />
          ) : (
            // Goal reached? Creator may finish the campaign, even earlier than the deadline:
            <ButtonFinishCampaign />
          )}
        </>
      }
    />
  );
}
