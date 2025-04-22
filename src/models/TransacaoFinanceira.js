const mongoose = require('mongoose');

const TransacaoFinanceiraSchema = new mongoose.Schema({
  laudo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Laudo',
    required: true
  },
  medico: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario',
    required: true
  },
  tipoExame: {
    type: String,
    required: true
  },
  valorBase: {
    type: Number,
    required: true,
    min: 0
  },
  comissao: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  valorMedico: {
    type: Number,
    required: true,
    min: 0
  },
  valorClinica: {
    type: Number,
    required: true,
    min: 0
  },
  dataLaudo: {
    type: Date,
    required: true
  },
  dataPagamento: {
    type: Date
  },
  status: {
    type: String,
    enum: ['pendente', 'pago', 'cancelado'],
    default: 'pendente'
  },
  observacoes: String,
  criadoPor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario'
  }
}, { timestamps: true });

// Índices para melhor performance nas consultas
TransacaoFinanceiraSchema.index({ medico: 1 });
TransacaoFinanceiraSchema.index({ laudo: 1 });
TransacaoFinanceiraSchema.index({ dataLaudo: 1 });
TransacaoFinanceiraSchema.index({ status: 1 });

module.exports = mongoose.model('TransacaoFinanceira', TransacaoFinanceiraSchema);