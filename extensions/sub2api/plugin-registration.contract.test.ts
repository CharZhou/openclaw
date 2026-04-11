import { describePluginRegistrationContract } from "../../test/helpers/plugins/plugin-registration-contract.js";

describePluginRegistrationContract({
  pluginId: "sub2api",
  providerIds: ["sub2api-openai", "sub2api-anthropic"],
  mediaUnderstandingProviderIds: ["sub2api-openai", "sub2api-anthropic"],
});
