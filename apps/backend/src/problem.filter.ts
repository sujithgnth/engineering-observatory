import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import { Catch, HttpException, HttpStatus } from "@nestjs/common";
import type { Response } from "express";

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;
    const detail =
      typeof exceptionResponse === "string"
        ? exceptionResponse
        : typeof exceptionResponse === "object" &&
            exceptionResponse &&
            "message" in exceptionResponse
          ? Array.isArray(exceptionResponse.message)
            ? exceptionResponse.message.join("; ")
            : String(exceptionResponse.message)
          : status === 500
            ? "An unexpected error occurred."
            : "The request could not be completed.";

    response
      .status(status)
      .type("application/problem+json")
      .json({
        type: `https://engineering-observatory.local/problems/http-${status}`,
        title: HttpStatus[status] ?? "Error",
        status,
        code: status === 500 ? "internal_error" : "request_failed",
        detail,
      });
  }
}
