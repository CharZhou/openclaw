import {
  describeImageWithModel,
  describeImagesWithModel,
  type MediaUnderstandingProvider,
} from "openclaw/plugin-sdk/media-understanding";
import {
  SUB2API_ANTHROPIC_DEFAULT_MODEL_ID,
  SUB2API_ANTHROPIC_PROVIDER_ID,
  SUB2API_OPENAI_DEFAULT_MODEL_ID,
  SUB2API_OPENAI_PROVIDER_ID,
} from "./defaults.js";

export const sub2ApiOpenAIMediaUnderstandingProvider: MediaUnderstandingProvider = {
  id: SUB2API_OPENAI_PROVIDER_ID,
  capabilities: ["image"],
  defaultModels: { image: SUB2API_OPENAI_DEFAULT_MODEL_ID },
  autoPriority: { image: 10 },
  describeImage: describeImageWithModel,
  describeImages: describeImagesWithModel,
};

export const sub2ApiAnthropicMediaUnderstandingProvider: MediaUnderstandingProvider = {
  id: SUB2API_ANTHROPIC_PROVIDER_ID,
  capabilities: ["image"],
  defaultModels: { image: SUB2API_ANTHROPIC_DEFAULT_MODEL_ID },
  autoPriority: { image: 20 },
  nativeDocumentInputs: ["pdf"],
  describeImage: describeImageWithModel,
  describeImages: describeImagesWithModel,
};
