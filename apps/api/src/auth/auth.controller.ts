import { Body, Controller, Post } from '@nestjs/common';
import { IsEmail } from 'class-validator';
import { AuthService, LoginResult } from './auth.service';
import { Public } from '../common/auth/public.decorator';

class LoginDto {
  @IsEmail()
  email!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * The only @Public() route in the application. Everything else inherits the global guard.
   *
   * Nothing from the request body is logged here. `email` is PII and a failed-login log line
   * containing it is a PII record with a different retention policy than the database it
   * came from - which is the same mistake, in a smaller font, as the PR in CODE_REVIEW.md.
   */
  @Public()
  @Post('login')
  async login(@Body() body: LoginDto): Promise<LoginResult> {
    return this.auth.login(body.email);
  }
}
