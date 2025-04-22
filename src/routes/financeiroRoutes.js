const express = require('express');
const financeiroController = require('../controllers/financeiroController');
const authMiddleware = require('../middleware/authMiddleware');
const autorizacaoMiddleware = require('../middleware/autorizacaoMiddleware');

const router = express.Router();

// Rotas para configuração financeira (apenas admin)
router.post(
    '/configurar/:medicoId',
    authMiddleware,        // Primeiro autentica
    autorizacaoMiddleware(['admin']), // Depois verifica as permissões
    financeiroController.configurarValoresMedico
  );

router.get(
  '/configurar/:medicoId',
  authMiddleware,
  autorizacaoMiddleware(['admin', 'medico']),
  financeiroController.obterConfiguracaoMedico
);

// Rotas para relatórios (admin e médicos podem ver os próprios)
router.get(
  '/relatorios',
  authMiddleware,
  autorizacaoMiddleware(['admin', 'medico']),
  financeiroController.gerarRelatorioFinanceiro
);

// Atualizar status de pagamento (apenas admin)
router.put(
  '/transacoes/:transacaoId/status',
  authMiddleware,
  autorizacaoMiddleware(['admin']),
  financeiroController.atualizarStatusPagamento
);

// Rotas para faturas
router.post(
    '/faturas/gerar/:medicoId/mes/:mes/ano/:ano',
    authMiddleware,
    autorizacaoMiddleware(['admin']),
    financeiroController.gerarFaturaMensal
  );
  
  // Rota para exportação
  router.get(
    '/relatorios/exportar',
    authMiddleware,
    autorizacaoMiddleware(['admin']),
    financeiroController.exportarRelatorioExcel
  );
  
  // Rota para dashboard
  router.get(
    '/dashboard',
    authMiddleware,
    autorizacaoMiddleware(['admin']),
    financeiroController.obterDashboardFinanceiro
  );

router.get(
    '/configurar/:medicoId/historico',
    authMiddleware,
    autorizacaoMiddleware(['admin']),
    financeiroController.obterHistoricoConfiguracoes
);

module.exports = router;