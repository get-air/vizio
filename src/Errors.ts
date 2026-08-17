import { Schema } from "effect"

export class VizioInvalidConfigError extends Schema.TaggedError<VizioInvalidConfigError>()(
  "VizioInvalidConfigError",
  { field: Schema.String, message: Schema.String },
) {}

export class VizioTransportError extends Schema.TaggedError<VizioTransportError>()(
  "VizioTransportError",
  {
    method: Schema.String,
    url: Schema.String,
    message: Schema.String,
    retryable: Schema.Boolean,
  },
) {}

export class VizioTimeoutError extends Schema.TaggedError<VizioTimeoutError>()(
  "VizioTimeoutError",
  { method: Schema.String, url: Schema.String, timeoutMillis: Schema.Number, message: Schema.String },
) {}

export class VizioHttpStatusError extends Schema.TaggedError<VizioHttpStatusError>()(
  "VizioHttpStatusError",
  { method: Schema.String, url: Schema.String, status: Schema.Number, message: Schema.String },
) {}

export class VizioAuthError extends Schema.TaggedError<VizioAuthError>()(
  "VizioAuthError",
  { path: Schema.String, message: Schema.String },
) {}

export class VizioInvalidResponseError extends Schema.TaggedError<VizioInvalidResponseError>()(
  "VizioInvalidResponseError",
  { path: Schema.String, message: Schema.String },
) {}

export class VizioInvalidParameterError extends Schema.TaggedError<VizioInvalidParameterError>()(
  "VizioInvalidParameterError",
  { path: Schema.String, result: Schema.String, message: Schema.String },
) {}

export class VizioInvalidInputError extends Schema.TaggedError<VizioInvalidInputError>()(
  "VizioInvalidInputError",
  { input: Schema.String, candidates: Schema.Array(Schema.String), message: Schema.String },
) {}

export class VizioItemNotFoundError extends Schema.TaggedError<VizioItemNotFoundError>()(
  "VizioItemNotFoundError",
  { path: Schema.String, item: Schema.String, message: Schema.String },
) {}

export class VizioEndpointNotFoundError extends Schema.TaggedError<VizioEndpointNotFoundError>()(
  "VizioEndpointNotFoundError",
  { path: Schema.String, message: Schema.String },
) {}

export class VizioBusyError extends Schema.TaggedError<VizioBusyError>()(
  "VizioBusyError",
  { path: Schema.String, result: Schema.String, message: Schema.String },
) {}

export class VizioUnsupportedError extends Schema.TaggedError<VizioUnsupportedError>()(
  "VizioUnsupportedError",
  { feature: Schema.String, message: Schema.String },
) {}

export class VizioPersistenceReadError extends Schema.TaggedError<VizioPersistenceReadError>()(
  "VizioPersistenceReadError",
  { message: Schema.String },
) {}

export class VizioPersistenceWriteError extends Schema.TaggedError<VizioPersistenceWriteError>()(
  "VizioPersistenceWriteError",
  { message: Schema.String },
) {}

export type VizioRequestError =
  | VizioTransportError
  | VizioTimeoutError
  | VizioHttpStatusError
  | VizioAuthError
  | VizioInvalidResponseError
  | VizioInvalidParameterError
  | VizioEndpointNotFoundError
  | VizioBusyError

export type VizioError =
  | VizioInvalidConfigError
  | VizioRequestError
  | VizioInvalidInputError
  | VizioItemNotFoundError
  | VizioUnsupportedError
  | VizioPersistenceReadError
  | VizioPersistenceWriteError
