const mongoose = require('mongoose');

const ItemFaturaSchema = new mongoose.Schema({
  transacao: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TransacaoFinanceira',
    required: true
  },
  valor: {
    type: Number,
    required: true
  }
}, { _id: false });

const FaturaSchema = new mongoose.Schema({
  medico: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario',
    required: true
  },
  periodoInicio: {
    type: Date,
    required: true
  },
  periodoFim: {
    type: Date,
    required: true
  },
  itens: [ItemFaturaSchema],
  valorTotal: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pendente', 'paga', 'cancelada'],
    default: 'pendente'
  },
  dataPagamento: Date,
  observacoes: String,
  criadoPor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario'
  }
}, { timestamps: true });

module.exports = mongoose.model('Fatura', FaturaSchema);