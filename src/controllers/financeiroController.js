const { default: mongoose } = require('mongoose');
const ConfiguracaoFinanceira = require('../models/ConfiguracaoFinanceira');
const TransacaoFinanceira = require('../models/TransacaoFinanceira');
const Usuario = require('../models/Usuario');

// Configuração de valores por médico
exports.configurarValoresMedico = async (req, res) => {
    try {
        const { medicoId } = req.params;
        const { valoresPorTipo, comissao } = req.body;
        const usuarioId = req.usuarioId;

        // Verificação mais robusta do usuário
        if (!usuarioId) {
            return res.status(401).json({ erro: 'Usuário não autenticado' });
        }

        // Validação mais robusta
        if (!medicoId || !mongoose.Types.ObjectId.isValid(medicoId)) {
        return res.status(400).json({ erro: 'ID do médico inválido' });
        }

        if (!Array.isArray(valoresPorTipo) || typeof comissao !== 'number') {
        return res.status(400).json({ erro: 'Dados inválidos' });
        }

        // Verificar se médico existe
        const medicoExiste = await Usuario.findById(medicoId);
        if (!medicoExiste) {
        return res.status(404).json({ erro: 'Médico não encontrado' });
        }

        // Validar cada item
        const valoresValidados = valoresPorTipo.map(item => {
        const valor = parseFloat(item.valor);
        if (isNaN(valor)) {
            throw new Error(`Valor inválido para o tipo ${item.tipoExame}`);
        }
        return {
            tipoExame: item.tipoExame,
            valor: valor
        };
        });

        // Desativar configurações anteriores
        await ConfiguracaoFinanceira.updateMany(
        { medico: medicoId, ativo: true },
        { 
            $set: { 
            ativo: false, 
            dataFimVigencia: new Date() 
            } 
        }
        );

        // Criar nova configuração com verificação explícita
        const novaConfig = await ConfiguracaoFinanceira.create({
            medico: medicoId,
            valoresPorTipo: valoresValidados,
            comissao,
            criadoPor: usuarioId, // Agora seguro pois verificamos acima
            dataInicioVigencia: new Date()
        });
    
        res.status(201).json({
            // Remova propriedades sensíveis ou desnecessárias
            id: novaConfig._id,
            medico: novaConfig.medico,
            valoresPorTipo: novaConfig.valoresPorTipo,
            comissao: novaConfig.comissao,
            ativo: novaConfig.ativo,
            dataInicioVigencia: novaConfig.dataInicioVigencia
        });

    } catch (err) {
        console.error('Erro ao configurar valores:', err);
        
        const statusCode = err.message.includes('inválido') ? 400 : 500;
        
        res.status(statusCode).json({ 
        erro: err.message || 'Erro ao salvar configuração',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
        });
    }
    };
  
  // Obter configuração atual de um médico
  exports.obterConfiguracaoMedico = async (req, res) => {
    try {
      const { medicoId } = req.params;
      
      // Busca a configuração ativa mais recente
      const config = await ConfiguracaoFinanceira.findOne({
        medico: medicoId,
        ativo: true
      }).sort({ createdAt: -1 });
  
      if (!config) {
        // Retorna configuração padrão se não existir
        return res.status(200).json({
          medico: medicoId,
          valoresPorTipo: [],
          comissao: 30,
          ativo: true
        });
      }
  
      res.status(200).json({
        _id: config._id,
        medico: config.medico,
        valoresPorTipo: config.valoresPorTipo,
        comissao: config.comissao,
        ativo: config.ativo,
        dataInicioVigencia: config.dataInicioVigencia
      });
    } catch (err) {
      console.error('Erro ao obter configuração:', err);
      res.status(500).json({ erro: 'Erro ao buscar configuração' });
    }
  };

// Gerar relatórios financeiros
exports.gerarRelatorioFinanceiro = async (req, res) => {
  try {
    const { medicoId, periodo, dataInicio, dataFim, tipoExame } = req.query;
    
    // Construir filtro
    const filtro = {};
    if (medicoId) filtro.medico = medicoId;
    if (tipoExame) filtro.tipoExame = tipoExame;

    // Configurar período
    if (periodo === 'dia') {
      const hoje = new Date();
      filtro.dataLaudo = {
        $gte: new Date(hoje.setHours(0, 0, 0, 0)),
        $lte: new Date(hoje.setHours(23, 59, 59, 999))
      };
    } else if (periodo === 'semana') {
      const hoje = new Date();
      const inicioSemana = new Date(hoje.setDate(hoje.getDate() - hoje.getDay()));
      const fimSemana = new Date(inicioSemana);
      fimSemana.setDate(inicioSemana.getDate() + 6);
      
      filtro.dataLaudo = {
        $gte: new Date(inicioSemana.setHours(0, 0, 0, 0)),
        $lte: new Date(fimSemana.setHours(23, 59, 59, 999))
      };
    } else if (periodo === 'mes') {
      const hoje = new Date();
      filtro.dataLaudo = {
        $gte: new Date(hoje.getFullYear(), hoje.getMonth(), 1),
        $lte: new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59, 999)
      };
    } else if (dataInicio && dataFim) {
      filtro.dataLaudo = {
        $gte: new Date(dataInicio),
        $lte: new Date(dataFim)
      };
    }

    // Obter transações
    const transacoes = await TransacaoFinanceira.find(filtro)
      .populate('medico', 'nome')
      .populate('laudo', 'exame')
      .sort({ dataLaudo: -1 });

    // Calcular totais
    const totais = {
      valorBase: 0,
      valorMedico: 0,
      valorClinica: 0,
      quantidade: transacoes.length
    };

    transacoes.forEach(t => {
      totais.valorBase += t.valorBase;
      totais.valorMedico += t.valorMedico;
      totais.valorClinica += t.valorClinica;
    });

    res.status(200).json({
      transacoes,
      totais,
      periodo: {
        tipo: periodo,
        inicio: filtro.dataLaudo?.$gte,
        fim: filtro.dataLaudo?.$lte
      }
    });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
};

// Atualizar status de pagamento
exports.atualizarStatusPagamento = async (req, res) => {
  try {
    const { transacaoId } = req.params;
    const { status, dataPagamento, observacoes } = req.body;

    const transacao = await TransacaoFinanceira.findByIdAndUpdate(
      transacaoId,
      {
        status,
        dataPagamento: status === 'pago' ? (dataPagamento || new Date()) : null,
        observacoes
      },
      { new: true }
    );

    if (!transacao) {
      return res.status(404).json({ mensagem: 'Transação não encontrada' });
    }

    res.status(200).json(transacao);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
};

exports.gerarFaturaMensal = async (req, res) => {
    try {
      const { medicoId, mes, ano } = req.params;
      
      // Calcular período do mês
      const inicioMes = new Date(ano, mes - 1, 1);
      const fimMes = new Date(ano, mes, 0, 23, 59, 59, 999);
  
      // Buscar transações do período
      const transacoes = await TransacaoFinanceira.find({
        medico: medicoId,
        dataLaudo: { $gte: inicioMes, $lte: fimMes },
        status: { $ne: 'cancelado' }
      });
  
      if (transacoes.length === 0) {
        return res.status(404).json({ mensagem: 'Nenhuma transação encontrada para o período' });
      }
  
      // Calcular total
      const valorTotal = transacoes.reduce((total, t) => total + t.valorMedico, 0);
  
      // Criar fatura
      const fatura = await Fatura.create({
        medico: medicoId,
        periodoInicio: inicioMes,
        periodoFim: fimMes,
        itens: transacoes.map(t => ({
          transacao: t._id,
          valor: t.valorMedico
        })),
        valorTotal,
        criadoPor: req.usuario.id
      });
  
      res.status(201).json(fatura);
    } catch (err) {
      res.status(500).json({ erro: err.message });
    }
  };
  
  // Exportar relatório em Excel
  exports.exportarRelatorioExcel = async (req, res) => {
    try {
      const { medicoId, periodo, dataInicio, dataFim, tipoExame } = req.query;
      
      // Mesmo filtro do relatório normal
      const filtro = {};
      if (medicoId) filtro.medico = medicoId;
      if (tipoExame) filtro.tipoExame = tipoExame;
  
      if (periodo === 'dia') {
        const hoje = new Date();
        filtro.dataLaudo = {
          $gte: new Date(hoje.setHours(0, 0, 0, 0)),
          $lte: new Date(hoje.setHours(23, 59, 59, 999))
        };
      } // ... outros períodos como no relatório normal
  
      const transacoes = await TransacaoFinanceira.find(filtro)
        .populate('medico', 'nome')
        .sort({ dataLaudo: 1 });
  
      // Criar workbook Excel
      const ExcelJS = require('exceljs');
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Relatório Financeiro');
  
      // Cabeçalhos
      worksheet.columns = [
        { header: 'Data', key: 'data', width: 15 },
        { header: 'Médico', key: 'medico', width: 25 },
        { header: 'Tipo Exame', key: 'tipoExame', width: 15 },
        { header: 'Valor (R$)', key: 'valor', width: 15, style: { numFmt: '"R$"#,##0.00' } },
        { header: 'Comissão (%)', key: 'comissao', width: 15 },
        { header: 'Valor Médico (R$)', key: 'valorMedico', width: 20, style: { numFmt: '"R$"#,##0.00' } },
        { header: 'Status', key: 'status', width: 15 }
      ];
  
      // Adicionar dados
      transacoes.forEach(t => {
        worksheet.addRow({
          data: t.dataLaudo,
          medico: t.medico.nome,
          tipoExame: t.tipoExame,
          valor: t.valorBase,
          comissao: t.comissao,
          valorMedico: t.valorMedico,
          status: t.status === 'pago' ? 'Pago' : t.status === 'cancelado' ? 'Cancelado' : 'Pendente'
        });
      });
  
      // Adicionar totais
      const totalValor = transacoes.reduce((sum, t) => sum + t.valorBase, 0);
      const totalMedico = transacoes.reduce((sum, t) => sum + t.valorMedico, 0);
  
      worksheet.addRow([]);
      worksheet.addRow({
        medico: 'TOTAIS:',
        valor: totalValor,
        valorMedico: totalMedico
      });
  
      // Configurar resposta
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=relatorio_financeiro.xlsx'
      );
  
      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      res.status(500).json({ erro: err.message });
    }
  };
  
  // Dashboard financeiro
  exports.obterDashboardFinanceiro = async (req, res) => {
    try {
      const hoje = new Date();
      const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59, 999);
  
      // Obter totais do mês atual
      const [totalMes, totalMedicos, transacoesRecentes] = await Promise.all([
        TransacaoFinanceira.aggregate([
          {
            $match: {
              dataLaudo: { $gte: inicioMes, $lte: fimMes },
              status: { $ne: 'cancelado' }
            }
          },
          {
            $group: {
              _id: null,
              totalBase: { $sum: "$valorBase" },
              totalMedico: { $sum: "$valorMedico" },
              totalClinica: { $sum: "$valorClinica" },
              count: { $sum: 1 }
            }
          }
        ]),
        TransacaoFinanceira.aggregate([
          {
            $match: {
              dataLaudo: { $gte: inicioMes, $lte: fimMes },
              status: { $ne: 'cancelado' }
            }
          },
          {
            $group: {
              _id: "$medico",
              total: { $sum: "$valorMedico" },
              count: { $sum: 1 }
            }
          },
          { $sort: { total: -1 } },
          { $limit: 5 }
        ]),
        TransacaoFinanceira.find()
          .sort({ dataLaudo: -1 })
          .limit(5)
          .populate('medico', 'nome')
      ]);
  
      // Obter dados para gráfico dos últimos 6 meses
      const seisMesesAtras = new Date();
      seisMesesAtras.setMonth(seisMesesAtras.getMonth() - 6);
  
      const dadosMensais = await TransacaoFinanceira.aggregate([
        {
          $match: {
            dataLaudo: { $gte: seisMesesAtras },
            status: { $ne: 'cancelado' }
          }
        },
        {
          $group: {
            _id: {
              year: { $year: "$dataLaudo" },
              month: { $month: "$dataLaudo" }
            },
            totalBase: { $sum: "$valorBase" },
            totalMedico: { $sum: "$valorMedico" },
            totalClinica: { $sum: "$valorClinica" }
          }
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } }
      ]);
  
      res.status(200).json({
        resumoMes: totalMes[0] || { totalBase: 0, totalMedico: 0, totalClinica: 0, count: 0 },
        topMedicos: totalMedicos,
        transacoesRecentes,
        historicoMensal: dadosMensais.map(item => ({
          mes: `${item._id.month}/${item._id.year}`,
          ...item
        }))
      });
    } catch (err) {
      res.status(500).json({ erro: err.message });
    }
  };

  // No controller
exports.obterHistoricoConfiguracoes = async (req, res) => {
    try {
      const { medicoId } = req.params;
      const historico = await ConfiguracaoFinanceira.find({
        medico: medicoId
      }).sort({ dataInicioVigencia: -1 });
      
      res.status(200).json(historico);
    } catch (err) {
      res.status(500).json({ erro: err.message });
    }
  };