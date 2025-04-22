const express = require('express');
const authController = require('../controllers/authController');
const { auditLog } = require('../middleware/auditMiddleware');
const {
    limiterLogin,
    limiterRegistro,
    limiterEsqueciSenha,
    limiterRefresh
  } = require('../middleware/rateLimiters');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/registrar', 
    limiterRegistro,
    authController.validarRegistro, 
    auditLog('create', 'Tentativa de registro de usuário'),
    authController.registrar
);

router.post('/login', 
    limiterLogin,
    authController.validarLogin, 
    auditLog('login', 'Tentativa de login'),
    authController.login
);

router.post('/refresh-token', 
    limiterRefresh,
    auditLog('refresh_token', 'Tentativa de refresh token'),
    authController.refreshToken
);

// Novas rotas para recuperação de senha
router.post('/esqueci-senha', 
    limiterEsqueciSenha,
    authController.validarEmail,
    auditLog('forgot_password', 'Solicitação de recuperação de senha'),
    authController.esqueciSenha
);

router.post('/resetar-senha', 
    authController.validarResetSenha,
    auditLog('reset_password', 'Tentativa de resetar senha'),
    authController.resetarSenha
);


router.get('/check', (req, res) => {
    res.json({ status: 'authenticated', user: req.user });
  });

module.exports = router;