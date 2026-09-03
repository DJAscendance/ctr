import Router from 'express';
import {betaSignupController} from '../controllers';

const betaSignupRoutes = Router();
betaSignupRoutes.post('/', (request, response) =>
  betaSignupController.register(request, response));
betaSignupRoutes.get('/', (request, response) =>
  betaSignupController.list(request, response));

export {betaSignupRoutes};
