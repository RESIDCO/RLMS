export class CrmHttpError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, message: string, body: Record<string, unknown> = {}) {
    super(message);
    this.name = "CrmHttpError";
    this.status = status;
    this.body = body;
  }
}
