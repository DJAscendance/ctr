import Router from 'express';

import { bankController } from '../controllers';

/**
 * Routing for the Cybertown Bank.
 * @note All paths used here will be prepended with `/api/bank`.
 */

const bankRoutes = Router();
bankRoutes.get('/account', (request, response) => bankController.getAccount(request, response));
bankRoutes.post('/transfer', (request, response) => bankController.transfer(request, response));

export { bankRoutes };
